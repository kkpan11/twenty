import * as fs from 'fs/promises';
import { join } from 'path';

import {
  CreateFunctionCommand,
  DeleteFunctionCommand,
  GetFunctionCommand,
  InvokeCommand,
  InvokeCommandInput,
  Lambda,
  LambdaClientConfig,
  ListLayerVersionsCommand,
  ListLayerVersionsCommandInput,
  PublishLayerVersionCommand,
  PublishLayerVersionCommandInput,
  PublishVersionCommand,
  PublishVersionCommandInput,
  ResourceNotFoundException,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
  UpdateFunctionConfigurationCommandInput,
  waitUntilFunctionUpdatedV2,
} from '@aws-sdk/client-lambda';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { CreateFunctionCommandInput } from '@aws-sdk/client-lambda/dist-types/commands/CreateFunctionCommand';
import { UpdateFunctionCodeCommandInput } from '@aws-sdk/client-lambda/dist-types/commands/UpdateFunctionCodeCommand';
import dotenv from 'dotenv';
import { isDefined } from 'twenty-shared';

import {
  ServerlessDriver,
  ServerlessExecuteResult,
} from 'src/engine/core-modules/serverless/drivers/interfaces/serverless-driver.interface';

import { FileStorageService } from 'src/engine/core-modules/file-storage/file-storage.service';
import { COMMON_LAYER_NAME } from 'src/engine/core-modules/serverless/drivers/constants/common-layer-name';
import { ENV_FILE_NAME } from 'src/engine/core-modules/serverless/drivers/constants/env-file-name';
import { OUTDIR_FOLDER } from 'src/engine/core-modules/serverless/drivers/constants/outdir-folder';
import { SERVERLESS_TMPDIR_FOLDER } from 'src/engine/core-modules/serverless/drivers/constants/serverless-tmpdir-folder';
import { compileTypescript } from 'src/engine/core-modules/serverless/drivers/utils/compile-typescript';
import { copyAndBuildDependencies } from 'src/engine/core-modules/serverless/drivers/utils/copy-and-build-dependencies';
import { createZipFile } from 'src/engine/core-modules/serverless/drivers/utils/create-zip-file';
import {
  LambdaBuildDirectoryManager,
  NODE_LAYER_SUBFOLDER,
} from 'src/engine/core-modules/serverless/drivers/utils/lambda-build-directory-manager';
import { getServerlessFolder } from 'src/engine/core-modules/serverless/utils/serverless-get-folder.utils';
import { ServerlessFunctionExecutionStatus } from 'src/engine/metadata-modules/serverless-function/dtos/serverless-function-execution-result.dto';
import {
  ServerlessFunctionEntity,
  ServerlessFunctionRuntime,
} from 'src/engine/metadata-modules/serverless-function/serverless-function.entity';
import {
  ServerlessFunctionException,
  ServerlessFunctionExceptionCode,
} from 'src/engine/metadata-modules/serverless-function/serverless-function.exception';

const UPDATE_FUNCTION_DURATION_TIMEOUT_IN_SECONDS = 60;
const CREDENTIALS_DURATION_IN_SECONDS = 10 * 60 * 60; // 10h

export interface LambdaDriverOptions extends LambdaClientConfig {
  fileStorageService: FileStorageService;
  region: string;
  lambdaRole: string;
  subhostingRole?: string;
}

export class LambdaDriver implements ServerlessDriver {
  private lambdaClient: Lambda | undefined;
  private credentialsExpiry: Date | null = null;
  private readonly options: LambdaDriverOptions;
  private readonly fileStorageService: FileStorageService;

  constructor(options: LambdaDriverOptions) {
    this.options = options;
    this.lambdaClient = undefined;
    this.fileStorageService = options.fileStorageService;
  }

  private async getLambdaClient() {
    if (
      !isDefined(this.lambdaClient) ||
      (isDefined(this.options.subhostingRole) &&
        isDefined(this.credentialsExpiry) &&
        new Date() >= this.credentialsExpiry)
    ) {
      this.lambdaClient = new Lambda({
        ...this.options,
        ...(isDefined(this.options.subhostingRole) && {
          credentials: await this.getAssumeRoleCredentials(),
        }),
      });
    }

    return this.lambdaClient;
  }

  private async getAssumeRoleCredentials() {
    const stsClient = new STSClient({ region: this.options.region });

    this.credentialsExpiry = new Date(
      Date.now() + (CREDENTIALS_DURATION_IN_SECONDS - 60 * 5) * 1000,
    );

    const assumeRoleCommand = new AssumeRoleCommand({
      RoleArn: 'arn:aws:iam::820242914089:role/LambdaDeploymentRole',
      RoleSessionName: 'LambdaSession',
      DurationSeconds: CREDENTIALS_DURATION_IN_SECONDS,
    });

    const { Credentials } = await stsClient.send(assumeRoleCommand);

    if (
      !isDefined(Credentials) ||
      !isDefined(Credentials.AccessKeyId) ||
      !isDefined(Credentials.SecretAccessKey) ||
      !isDefined(Credentials.SessionToken)
    ) {
      throw new Error('Failed to assume role');
    }

    return {
      accessKeyId: Credentials.AccessKeyId,
      secretAccessKey: Credentials.SecretAccessKey,
      sessionToken: Credentials.SessionToken,
    };
  }

  private async waitFunctionUpdates(
    serverlessFunctionId: string,
    maxWaitTime: number = UPDATE_FUNCTION_DURATION_TIMEOUT_IN_SECONDS,
  ) {
    const waitParams = { FunctionName: serverlessFunctionId };

    await waitUntilFunctionUpdatedV2(
      { client: await this.getLambdaClient(), maxWaitTime },
      waitParams,
    );
  }

  private async createLayerIfNotExists(version: number): Promise<string> {
    const listLayerParams: ListLayerVersionsCommandInput = {
      LayerName: COMMON_LAYER_NAME,
      MaxItems: 1,
    };
    const listLayerCommand = new ListLayerVersionsCommand(listLayerParams);
    const listLayerResult = await (
      await this.getLambdaClient()
    ).send(listLayerCommand);

    if (
      isDefined(listLayerResult.LayerVersions) &&
      listLayerResult.LayerVersions.length > 0 &&
      listLayerResult.LayerVersions?.[0].Description === `${version}` &&
      isDefined(listLayerResult.LayerVersions[0].LayerVersionArn)
    ) {
      return listLayerResult.LayerVersions[0].LayerVersionArn;
    }

    const lambdaBuildDirectoryManager = new LambdaBuildDirectoryManager();
    const { sourceTemporaryDir, lambdaZipPath } =
      await lambdaBuildDirectoryManager.init();

    const nodeDependenciesFolder = join(
      sourceTemporaryDir,
      NODE_LAYER_SUBFOLDER,
    );

    await copyAndBuildDependencies(nodeDependenciesFolder);

    await createZipFile(sourceTemporaryDir, lambdaZipPath);

    const params: PublishLayerVersionCommandInput = {
      LayerName: COMMON_LAYER_NAME,
      Content: {
        ZipFile: await fs.readFile(lambdaZipPath),
      },
      CompatibleRuntimes: [ServerlessFunctionRuntime.NODE18],
      Description: `${version}`,
    };

    const command = new PublishLayerVersionCommand(params);

    const result = await (await this.getLambdaClient()).send(command);

    await lambdaBuildDirectoryManager.clean();

    if (!isDefined(result.LayerVersionArn)) {
      throw new Error('new layer version arn if undefined');
    }

    return result.LayerVersionArn;
  }

  private async checkFunctionExists(functionName: string): Promise<boolean> {
    try {
      const getFunctionCommand = new GetFunctionCommand({
        FunctionName: functionName,
      });

      await (await this.getLambdaClient()).send(getFunctionCommand);

      return true;
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        return false;
      }
      throw error;
    }
  }

  async delete(serverlessFunction: ServerlessFunctionEntity) {
    const functionExists = await this.checkFunctionExists(
      serverlessFunction.id,
    );

    if (functionExists) {
      const deleteFunctionCommand = new DeleteFunctionCommand({
        FunctionName: serverlessFunction.id,
      });

      await (await this.getLambdaClient()).send(deleteFunctionCommand);
    }
  }

  private getInMemoryServerlessFunctionFolderPath = (
    serverlessFunction: ServerlessFunctionEntity,
    version: string,
  ) => {
    return join(SERVERLESS_TMPDIR_FOLDER, serverlessFunction.id, version);
  };

  async build(serverlessFunction: ServerlessFunctionEntity, version: 'draft') {
    if (version !== 'draft') {
      throw new Error("We can only build 'draft' version with lambda driver");
    }

    const inMemoryServerlessFunctionFolderPath =
      this.getInMemoryServerlessFunctionFolderPath(serverlessFunction, version);

    const folderPath = getServerlessFolder({
      serverlessFunction,
      version,
    });

    await this.fileStorageService.download({
      from: { folderPath },
      to: { folderPath: inMemoryServerlessFunctionFolderPath },
    });

    compileTypescript(inMemoryServerlessFunctionFolderPath);

    const lambdaZipPath = join(
      inMemoryServerlessFunctionFolderPath,
      'lambda.zip',
    );

    await createZipFile(
      join(inMemoryServerlessFunctionFolderPath, OUTDIR_FOLDER),
      lambdaZipPath,
    );

    const envFileContent = await fs.readFile(
      join(inMemoryServerlessFunctionFolderPath, ENV_FILE_NAME),
    );

    const envVariables = dotenv.parse(envFileContent);

    const functionExists = await this.checkFunctionExists(
      serverlessFunction.id,
    );

    if (!functionExists) {
      const layerArn = await this.createLayerIfNotExists(
        serverlessFunction.layerVersion,
      );

      const params: CreateFunctionCommandInput = {
        Code: {
          ZipFile: await fs.readFile(lambdaZipPath),
        },
        FunctionName: serverlessFunction.id,
        Handler: 'src/index.main',
        Layers: [layerArn],
        Environment: {
          Variables: envVariables,
        },
        Role: this.options.lambdaRole,
        Runtime: serverlessFunction.runtime,
        Description: 'Lambda function to run user script',
        Timeout: serverlessFunction.timeoutSeconds,
      };

      const command = new CreateFunctionCommand(params);

      await (await this.getLambdaClient()).send(command);
    } else {
      const updateCodeParams: UpdateFunctionCodeCommandInput = {
        ZipFile: await fs.readFile(lambdaZipPath),
        FunctionName: serverlessFunction.id,
      };

      const updateCodeCommand = new UpdateFunctionCodeCommand(updateCodeParams);

      await (await this.getLambdaClient()).send(updateCodeCommand);

      const updateConfigurationParams: UpdateFunctionConfigurationCommandInput =
        {
          Environment: {
            Variables: envVariables,
          },
          FunctionName: serverlessFunction.id,
          Timeout: serverlessFunction.timeoutSeconds,
        };

      const updateConfigurationCommand = new UpdateFunctionConfigurationCommand(
        updateConfigurationParams,
      );

      await this.waitFunctionUpdates(serverlessFunction.id);

      await (await this.getLambdaClient()).send(updateConfigurationCommand);
    }

    await this.waitFunctionUpdates(serverlessFunction.id);
  }

  async publish(serverlessFunction: ServerlessFunctionEntity) {
    await this.build(serverlessFunction, 'draft');
    const params: PublishVersionCommandInput = {
      FunctionName: serverlessFunction.id,
    };

    const command = new PublishVersionCommand(params);

    const result = await (await this.getLambdaClient()).send(command);
    const newVersion = result.Version;

    if (!newVersion) {
      throw new Error('New published version is undefined');
    }

    const draftFolderPath = getServerlessFolder({
      serverlessFunction: serverlessFunction,
      version: 'draft',
    });
    const newFolderPath = getServerlessFolder({
      serverlessFunction: serverlessFunction,
      version: newVersion,
    });

    await this.fileStorageService.copy({
      from: { folderPath: draftFolderPath },
      to: { folderPath: newFolderPath },
    });

    return newVersion;
  }

  async execute(
    functionToExecute: ServerlessFunctionEntity,
    payload: object,
    version: string,
  ): Promise<ServerlessExecuteResult> {
    const computedVersion =
      version === 'latest' ? functionToExecute.latestVersion : version;

    const functionName =
      computedVersion === 'draft'
        ? functionToExecute.id
        : `${functionToExecute.id}:${computedVersion}`;

    if (version === 'draft') {
      await this.waitFunctionUpdates(functionToExecute.id);
    }

    const startTime = Date.now();

    const params: InvokeCommandInput = {
      FunctionName: functionName,
      Payload: JSON.stringify(payload),
    };

    const command = new InvokeCommand(params);

    try {
      const result = await (await this.getLambdaClient()).send(command);

      const parsedResult = result.Payload
        ? JSON.parse(result.Payload.transformToString())
        : {};

      const duration = Date.now() - startTime;

      if (result.FunctionError) {
        return {
          data: null,
          duration,
          status: ServerlessFunctionExecutionStatus.ERROR,
          error: parsedResult,
        };
      }

      return {
        data: parsedResult,
        duration,
        status: ServerlessFunctionExecutionStatus.SUCCESS,
      };
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw new ServerlessFunctionException(
          `Function Version '${version}' does not exist`,
          ServerlessFunctionExceptionCode.SERVERLESS_FUNCTION_NOT_FOUND,
        );
      }
      throw error;
    }
  }
}
