import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejsFn from 'aws-cdk-lib/aws-lambda-nodejs';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';

interface NotificationStackProps extends cdk.StackProps {
  environment: string;
  table: dynamodb.Table;
  sesFromEmail: string;
}

export class NotificationStack extends cdk.Stack {
  /** Handles overdue-alert and invoice-reminder EventBridge events. */
  public readonly notificationSenderFn: lambda.Function;
  /** Aggregates monthly analytics on the 1st of each month. */
  public readonly monthlyAnalyticsFn: lambda.Function;

  constructor(scope: Construct, id: string, props: NotificationStackProps) {
    super(scope, id, props);

    const handlersDir = path.join(__dirname, '../../../../backend/handlers');

    const notificationsTopic = new sns.Topic(this, 'NotificationsTopic', {
      topicName: `CantiereSnap-notifications-${props.environment}`,
      displayName: 'CantiereSnap SMS Notifications',
    });

    // Verify the sender email identity with SES; must be confirmed in the AWS console
    // or via DNS before sending (requires account out of SES sandbox for production).
    new ses.EmailIdentity(this, 'FromEmailIdentity', {
      identity: ses.Identity.email(props.sesFromEmail),
    });

    const senderEnv = {
      TABLE_NAME: props.table.tableName,
      SNS_TOPIC_ARN: notificationsTopic.topicArn,
      SES_FROM_EMAIL: props.sesFromEmail,
      ENVIRONMENT: props.environment,
    };

    this.notificationSenderFn = new nodejsFn.NodejsFunction(this, 'NotificationSenderFn', {
      entry: path.join(handlersDir, 'notification-sender.handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: senderEnv,
      bundling: { minify: true, sourceMap: false },
    });

    this.monthlyAnalyticsFn = new nodejsFn.NodejsFunction(this, 'MonthlyAnalyticsFn', {
      entry: path.join(handlersDir, 'monthly-analytics.handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        TABLE_NAME: props.table.tableName,
        ENVIRONMENT: props.environment,
      },
      bundling: { minify: true, sourceMap: false },
    });

    // DynamoDB: sender reads invoices and logs notifications; analytics reads/writes aggregates
    props.table.grantReadWriteData(this.notificationSenderFn);
    props.table.grantReadWriteData(this.monthlyAnalyticsFn);

    // SNS: sender publishes SMS messages
    notificationsTopic.grantPublish(this.notificationSenderFn);

    // SES: sender sends email reminders
    this.notificationSenderFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    }));
  }
}
