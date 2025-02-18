import {
  CreateManyResolverArgs,
  CreateOneResolverArgs,
  DeleteManyResolverArgs,
  DeleteOneResolverArgs,
  FindDuplicatesResolverArgs,
  FindManyResolverArgs,
  FindOneResolverArgs,
  UpdateManyResolverArgs,
  UpdateOneResolverArgs,
} from 'src/engine/graphql/workspace-resolver-builder/interfaces/workspace-resolvers-builder.interface';

export type ExecutePreHookMethod =
  | 'createMany'
  | 'createOne'
  | 'deleteMany'
  | 'deleteOne'
  | 'findMany'
  | 'findOne'
  | 'findDuplicates'
  | 'updateMany'
  | 'updateOne';

export type ObjectName = string;

export type HookName = string;

export type WorkspaceQueryHook = {
  [key in ObjectName]: {
    [key in ExecutePreHookMethod]?: HookName[];
  };
};

export type WorkspacePreQueryHookPayload<T> = T extends 'createMany'
  ? CreateManyResolverArgs
  : T extends 'createOne'
    ? CreateOneResolverArgs
    : T extends 'deleteMany'
      ? DeleteManyResolverArgs
      : T extends 'deleteOne'
        ? DeleteOneResolverArgs
        : T extends 'findMany'
          ? FindManyResolverArgs
          : T extends 'findOne'
            ? FindOneResolverArgs
            : T extends 'updateMany'
              ? UpdateManyResolverArgs
              : T extends 'updateOne'
                ? UpdateOneResolverArgs
                : T extends 'findDuplicates'
                  ? FindDuplicatesResolverArgs
                  : never;
