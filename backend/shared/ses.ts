import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

export const sesClient = new SESClient({ region: process.env.AWS_REGION ?? 'eu-south-1' });

export async function sendEmail(params: {
  to: string;
  from: string;
  subject: string;
  htmlBody: string;
  textBody: string;
}): Promise<void> {
  await sesClient.send(
    new SendEmailCommand({
      Destination: { ToAddresses: [params.to] },
      Source: params.from,
      Message: {
        Subject: { Data: params.subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: params.htmlBody, Charset: 'UTF-8' },
          Text: { Data: params.textBody, Charset: 'UTF-8' },
        },
      },
    }),
  );
}
