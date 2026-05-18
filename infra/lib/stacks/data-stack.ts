import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

interface DataStackProps extends cdk.StackProps {
  environment: string;
}

export class DataStack extends cdk.Stack {
  public readonly table: dynamodb.Table;
  public readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const isProd = props.environment === 'production';

    // ── DynamoDB single-table ────────────────────────────────────────────────
    this.table = new dynamodb.Table(this, 'Table', {
      tableName: `CantiereSnapTable-${props.environment}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl',
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // GSI-1 StatusIndex: supports Kanban filtering (JOB#<status>#<date>)
    // and invoice-by-status queries (INV#<status>#<date>), plus client name search.
    this.table.addGlobalSecondaryIndex({
      indexName: 'StatusIndex',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI-2 DueDateIndex: cross-user invoice due-date queries for EventBridge
    // notification Lambdas. Partition key is NOT user-scoped by design (see schema doc §4.2).
    this.table.addGlobalSecondaryIndex({
      indexName: 'DueDateIndex',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.INCLUDE,
      nonKeyAttributes: [
        'userId',
        'jobId',
        'clientName',
        'clientEmail',
        'invoiceNumber',
        'totalAmount',
      ],
    });

    // ── S3 bucket ────────────────────────────────────────────────────────────
    this.bucket = new s3.Bucket(this, 'DataBucket', {
      // Include account ID to ensure global uniqueness
      bucketName: `cantieresnap-data-${props.environment}-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: false,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
      lifecycleRules: [
        {
          id: 'UsersIaTransitionAndExpiry',
          prefix: 'users/',
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
          expiration: cdk.Duration.days(365),
        },
      ],
      // Browser presigned-URL uploads (PUT) and direct GET/HEAD reads require CORS.
      // allowedHeaders: ['*'] is needed because presigned PUTs include custom headers
      // such as x-amz-meta-tag that must pass the preflight check.
      // Restrict allowedOrigins in production to the CloudFront domain.
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: isProd ? ['https://your-production-domain.com'] : ['*'],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
    });
  }
}
