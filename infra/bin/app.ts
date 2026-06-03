import * as cdk from 'aws-cdk-lib';
import { DataStack } from '../lib/stacks/data-stack';
import { AuthStack } from '../lib/stacks/auth-stack';
import { ApiStack } from '../lib/stacks/api-stack';
import { NotificationStack } from '../lib/stacks/notification-stack';
import { SchedulingStack } from '../lib/stacks/scheduling-stack';
import { BenchmarkStack } from '../lib/stacks/benchmark-stack';

const app = new cdk.App();

const env = app.node.tryGetContext('env') ?? 'staging';
const ctx = app.node.tryGetContext(env) as {
  account: string;
  region: string;
  sesFromEmail: string;
};

if (!ctx) {
  throw new Error(`No context found for env "${env}". Add it to cdk.json under context.${env}`);
}

const awsEnv: cdk.Environment = { account: ctx.account, region: ctx.region };
const id = (name: string) => `CantiereSnap-${name}-${env}`;

// ── DataStack ───────────────────────────────────────────────────────────────
const dataStack = new DataStack(app, id('DataStack'), {
  env: awsEnv,
  environment: env,
});

// ── AuthStack ───────────────────────────────────────────────────────────────
const authStack = new AuthStack(app, id('AuthStack'), {
  env: awsEnv,
  environment: env,
});

// ── ApiStack  ────────────────────────────────────────────────────── (needs Data + Auth)
const apiStack = new ApiStack(app, id('ApiStack'), {
  env: awsEnv,
  environment: env,
  table: dataStack.table,
  bucket: dataStack.bucket,
  userPool: authStack.userPool,
  userPoolClientId: authStack.userPoolClient.userPoolClientId,
});
apiStack.addDependency(dataStack);
apiStack.addDependency(authStack);

// ── NotificationStack ────────────────────────────────────────────── (needs Data)
const notificationStack = new NotificationStack(app, id('NotificationStack'), {
  env: awsEnv,
  environment: env,
  table: dataStack.table,
  sesFromEmail: ctx.sesFromEmail,
});
notificationStack.addDependency(dataStack);

// ── SchedulingStack ──────────────────────────────────────────────── (needs Notification + Api)
const schedulingStack = new SchedulingStack(app, id('SchedulingStack'), {
  env: awsEnv,
  environment: env,
  notificationSenderFn: notificationStack.notificationSenderFn,
  monthlyAnalyticsFn: notificationStack.monthlyAnalyticsFn,
});
schedulingStack.addDependency(notificationStack);
schedulingStack.addDependency(apiStack);

// ── BenchmarkStack ───────────────────────────────── (deploy only for RQ3 benchmarking)
// Imports staging DynamoDB table + S3 bucket by name — no new data resources created.
// Deploy:  npx cdk deploy CantiereSnap-BenchmarkStack --context env=benchmark
// Destroy: npx cdk destroy CantiereSnap-BenchmarkStack --context env=benchmark --force
if (env === 'benchmark') {
  new BenchmarkStack(app, 'CantiereSnap-BenchmarkStack', { env: awsEnv });
}

app.synth();
