import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

export const snsClient = new SNSClient({ region: process.env.AWS_REGION ?? 'eu-south-1' });

export async function publishSms(topicArn: string, message: string): Promise<void> {
  await snsClient.send(new PublishCommand({ TopicArn: topicArn, Message: message }));
}
