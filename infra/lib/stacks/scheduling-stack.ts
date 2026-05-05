import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

interface SchedulingStackProps extends cdk.StackProps {
  environment: string;
  /** Handles both 'overdue-alert' and 'invoice-reminder' EventBridge triggers. */
  notificationSenderFn: lambda.Function;
  /** Handles the 'monthly-analytics' EventBridge trigger. */
  monthlyAnalyticsFn: lambda.Function;
}

export class SchedulingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SchedulingStackProps) {
    super(scope, id, props);

    const ruleName = (name: string) => `CantiereSnap-${name}-${props.environment}`;

    // Daily at 08:00 UTC (09:00 CET / 10:00 CEST): mark invoices overdue and alert
    new events.Rule(this, 'OverdueAlertRule', {
      ruleName: ruleName('overdue-alert'),
      schedule: events.Schedule.cron({ minute: '0', hour: '8' }),
      targets: [
        new targets.LambdaFunction(props.notificationSenderFn, {
          event: events.RuleTargetInput.fromObject({ source: 'overdue-alert' }),
        }),
      ],
    });

    // Daily at 08:05 UTC: remind tradespeople of invoices due within 7 days
    new events.Rule(this, 'InvoiceReminderRule', {
      ruleName: ruleName('invoice-reminder'),
      schedule: events.Schedule.cron({ minute: '5', hour: '8' }),
      targets: [
        new targets.LambdaFunction(props.notificationSenderFn, {
          event: events.RuleTargetInput.fromObject({ source: 'invoice-reminder' }),
        }),
      ],
    });

    // 1st of every month at 01:00 UTC: aggregate previous month's analytics
    new events.Rule(this, 'MonthlyAnalyticsRule', {
      ruleName: ruleName('monthly-analytics'),
      schedule: events.Schedule.cron({ minute: '0', hour: '1', day: '1', month: '*' }),
      targets: [
        new targets.LambdaFunction(props.monthlyAnalyticsFn, {
          event: events.RuleTargetInput.fromObject({ source: 'monthly-analytics' }),
        }),
      ],
    });
  }
}
