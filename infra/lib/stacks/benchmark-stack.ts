/**
 * BenchmarkStack — temporary Fargate service for RQ3 thesis comparison.
 *
 * Deploy:  cd infra && npx cdk deploy CantiereSnap-BenchmarkStack --context env=benchmark
 * Destroy: cd infra && npx cdk destroy CantiereSnap-BenchmarkStack --context env=benchmark
 *
 * Uses the SAME DynamoDB table and S3 bucket as the Lambda staging stack.
 * The Fargate task runs the same handler code but with no API Gateway timeout
 * constraint — the key difference being synchronous AI quote generation.
 */

import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface BenchmarkStackProps extends cdk.StackProps {}

export class BenchmarkStack extends cdk.Stack {
  /** Public ALB URL for the Fargate service — use in Artillery fargate-benchmark.yml */
  public readonly albUrl: string;

  constructor(scope: Construct, id: string, props: BenchmarkStackProps) {
    super(scope, id, props);

    // Import the EXISTING staging resources by name — the benchmark intentionally
    // shares the same DynamoDB table and S3 bucket as the Lambda staging stack so
    // both platforms read and write the same data during the comparison.
    const table = dynamodb.Table.fromTableName(this, 'StagingTable', 'CantiereSnapTable-staging');
    const bucket = s3.Bucket.fromBucketName(this, 'StagingBucket', `cantieresnap-data-staging-${this.account}`);

    // Retrieve the Anthropic API key from Parameter Store (same key as Lambda staging)
    const anthropicApiKey = ssm.StringParameter.valueForStringParameter(
      this,
      '/cantieresnap/staging/anthropic-api-key',
    );

    // ── VPC — public subnets only; Fargate tasks need internet for Claude API ─
    const vpc = new ec2.Vpc(this, 'BenchmarkVpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
      ],
    });

    // ── ECS Cluster ────────────────────────────────────────────────────────────
    const cluster = new ecs.Cluster(this, 'BenchmarkCluster', {
      vpc,
      clusterName: 'cantieresnap-benchmark',
      containerInsights: true,
    });

    // ── Log group ──────────────────────────────────────────────────────────────
    const logGroup = new logs.LogGroup(this, 'BenchmarkLogs', {
      logGroupName: '/fargate/cantieresnap-benchmark',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── Docker image — build context is repo root so both fargate-app/ and backend/ ─
    //    are accessible during the build. The Dockerfile is at:
    //    tests/benchmark/fargate-app/Dockerfile
    //    Uses .dockerignore at repo root to exclude node_modules, frontend, cdk.out/
    //    (without exclusions CDK recursively stages ~17 GB into cdk.out/ and fills disk).
    const repoRoot = path.join(__dirname, '../../../');
    const image = ecs.ContainerImage.fromAsset(repoRoot, {
      file: 'tests/benchmark/fargate-app/Dockerfile',
      ignoreMode: cdk.IgnoreMode.DOCKER,
    });

    // ── Fargate Task Definition ─────────────────────────────────────────────────
    // 0.5 vCPU / 1 GB memory — nearest equivalent to Lambda 512 MB
    const taskDef = new ecs.FargateTaskDefinition(this, 'BenchmarkTaskDef', {
      cpu: 512,
      memoryLimitMiB: 1024,
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
      },
    });

    taskDef.addContainer('BenchmarkContainer', {
      image,
      portMappings: [{ containerPort: 3000 }],
      environment: {
        TABLE_NAME: table.tableName,
        BUCKET_NAME: bucket.bucketName,
        AWS_REGION: this.region,
        NODE_ENV: 'production',
        // Resolve SSM value at CloudFormation deploy time — same pattern as Lambda stack
        ANTHROPIC_API_KEY: anthropicApiKey,
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'fargate',
        logGroup,
      }),
      healthCheck: {
        command: ['CMD-SHELL', 'wget -qO- http://localhost:3000/health || exit 1'],
        interval: cdk.Duration.seconds(15),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(30),
      },
    });

    // ── IAM — same permissions as the Lambda QuotesFn ──────────────────────────
    // grantReadWriteData on an imported table doesn't include GSI ARNs, so we
    // add an explicit statement covering the table and all its indexes.
    table.grantReadWriteData(taskDef.taskRole);
    taskDef.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:Query',
        'dynamodb:Scan',
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:BatchWriteItem',
        'dynamodb:BatchGetItem',
      ],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/CantiereSnapTable-staging`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/CantiereSnapTable-staging/index/*`,
      ],
    }));
    bucket.grantReadWrite(taskDef.taskRole);
    taskDef.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/cantieresnap/staging/*`],
    }));

    // ── ALB + Fargate Service ──────────────────────────────────────────────────
    const service = new ecsPatterns.ApplicationLoadBalancedFargateService(
      this,
      'BenchmarkService',
      {
        cluster,
        taskDefinition: taskDef,
        desiredCount: 1,
        assignPublicIp: true,
        publicLoadBalancer: true,
        listenerPort: 80,
        healthCheckGracePeriod: cdk.Duration.seconds(60),
      },
    );

    // Tune ALB health check to match the app's /health endpoint
    service.targetGroup.configureHealthCheck({
      path: '/health',
      interval: cdk.Duration.seconds(15),
      healthyHttpCodes: '200',
    });

    this.albUrl = `http://${service.loadBalancer.loadBalancerDnsName}`;

    // ── Outputs ────────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'FargateUrl', {
      value: this.albUrl,
      description: 'ALB URL for the Fargate benchmark service — use in fargate-benchmark.yml',
      exportName: 'CantiereSnap-BenchmarkStack-FargateUrl',
    });

    new cdk.CfnOutput(this, 'EcsCluster', {
      value: cluster.clusterName,
      description: 'ECS cluster name',
    });
  }
}
