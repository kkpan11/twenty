/* @license Enterprise */

import { CustomException } from 'src/utils/custom-exception';

export class BillingException extends CustomException {
  constructor(message: string, code: BillingExceptionCode) {
    super(message, code);
  }
}

export enum BillingExceptionCode {
  BILLING_CUSTOMER_NOT_FOUND = 'BILLING_CUSTOMER_NOT_FOUND',
  BILLING_PLAN_NOT_FOUND = 'BILLING_PLAN_NOT_FOUND',
  BILLING_PRODUCT_NOT_FOUND = 'BILLING_PRODUCT_NOT_FOUND',
  BILLING_PRICE_NOT_FOUND = 'BILLING_PRICE_NOT_FOUND',
  BILLING_SUBSCRIPTION_EVENT_WORKSPACE_NOT_FOUND = 'BILLING_SUBSCRIPTION_EVENT_WORKSPACE_NOT_FOUND',
  BILLING_ACTIVE_SUBSCRIPTION_NOT_FOUND = 'BILLING_ACTIVE_SUBSCRIPTION_NOT_FOUND',
  BILLING_METER_EVENT_FAILED = 'BILLING_METER_EVENT_FAILED',
}
