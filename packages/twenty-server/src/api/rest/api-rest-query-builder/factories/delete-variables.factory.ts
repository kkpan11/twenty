import { Injectable } from '@nestjs/common';

import { ApiRestQueryVariables } from 'src/api/rest/types/api-rest-query-variables.type';

@Injectable()
export class DeleteVariablesFactory {
  create(id: string): ApiRestQueryVariables {
    return {
      id: id,
    };
  }
}
