import { TextractClient } from '@aws-sdk/client-textract';

export const textractClient = new TextractClient({
  region: process.env.AWS_REGION ?? 'eu-south-1',
});
