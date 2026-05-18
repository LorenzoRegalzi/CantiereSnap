import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejsFn from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

interface ApiStackProps extends cdk.StackProps {
  environment: string;
  table: dynamodb.Table;
  bucket: s3.Bucket;
  userPool: cognito.UserPool;
  userPoolClientId: string;
}

export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const handlersDir = path.join(__dirname, '../../../backend/handlers');
    const backendRoot = path.join(__dirname, '../../../backend');

    const anthropicApiKey = ssm.StringParameter.valueForStringParameter(
      this,
      `/cantieresnap/${props.environment}/anthropic-api-key`,
    );

    const commonEnv: Record<string, string> = {
      TABLE_NAME: props.table.tableName,
      BUCKET_NAME: props.bucket.bucketName,
      USER_POOL_ID: props.userPool.userPoolId,
      CLIENT_ID: props.userPoolClientId,
      ENVIRONMENT: props.environment,
    };

    const fnDefaults: Partial<nodejsFn.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: commonEnv,
      projectRoot: backendRoot,
      depsLockFilePath: path.join(backendRoot, 'package-lock.json'),
      bundling: { minify: true, sourceMap: false },
    };

    const mkFn = (logicalId: string, entry: string, extra?: Partial<nodejsFn.NodejsFunctionProps>) =>
      new nodejsFn.NodejsFunction(this, logicalId, {
        ...fnDefaults,
        entry: path.join(handlersDir, entry),
        handler: 'handler',
        ...extra,
      });

    // ── Lambda handlers ──────────────────────────────────────────────────────
    const authFn = mkFn('AuthFn', 'auth.handler.ts');
    const jobsFn = mkFn('JobsFn', 'jobs.handler.ts');
    const clientsFn = mkFn('ClientsFn', 'clients.handler.ts');
    const quotesFn = mkFn('QuotesFn', 'quotes.handler.ts', {
      environment: { ...commonEnv, ANTHROPIC_API_KEY: anthropicApiKey },
      timeout: cdk.Duration.seconds(60),
      bundling: {
        minify: true,
        sourceMap: false,
        commandHooks: {
          afterBundling: (inputDir: string, outputDir: string): string[] => [
            `cp -r ${inputDir}/node_modules/pdfkit/js/data ${outputDir}/data`,
          ],
          beforeBundling: () => [],
          beforeInstall: () => [],
        },
      },
    });
    const photosFn = mkFn('PhotosFn', 'photos.handler.ts');
    const ocrFn = mkFn('OcrFn', 'ocr.handler.ts', {
      environment: { ...commonEnv, ANTHROPIC_API_KEY: anthropicApiKey },
      timeout: cdk.Duration.seconds(60),
    });
    const invoicesFn = mkFn('InvoicesFn', 'invoices.handler.ts');
    const dashboardFn = mkFn('DashboardFn', 'dashboard.handler.ts');
    const notificationsFn = mkFn('NotificationsFn', 'notifications.handler.ts');

    // ── IAM grants ───────────────────────────────────────────────────────────
    // authFn: profile reads/writes user profile entity in DynamoDB
    props.table.grantReadWriteData(authFn);
    authFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'cognito-idp:SignUp',
        'cognito-idp:ConfirmSignUp',
        'cognito-idp:InitiateAuth',
        'cognito-idp:RespondToAuthChallenge',
      ],
      resources: [props.userPool.userPoolArn],
    }));

    props.table.grantReadWriteData(jobsFn);
    props.bucket.grantRead(jobsFn);   // presigned GET URLs for photos in job details
    props.table.grantReadWriteData(clientsFn);
    props.table.grantReadWriteData(quotesFn);
    props.table.grantReadWriteData(photosFn);
    props.table.grantReadWriteData(ocrFn);
    props.table.grantReadWriteData(invoicesFn);
    props.table.grantReadData(dashboardFn);
    props.table.grantReadWriteData(notificationsFn);

    // S3 grants: presigned URL generation requires the same permissions as the operation
    props.bucket.grantReadWrite(photosFn);   // presigned GET (download) + PUT (upload)
    props.bucket.grantReadWrite(quotesFn);   // PDF read/write
    props.bucket.grantReadWrite(invoicesFn); // FatturaPA XML read/write
    props.bucket.grantReadWrite(ocrFn);      // receipt image read for Claude Vision

    // ── API Gateway ──────────────────────────────────────────────────────────
    const api = new apigateway.RestApi(this, 'Api', {
      restApiName: `CantiereSnap-${props.environment}`,
      deployOptions: {
        stageName: props.environment,
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'Authorizer', {
      cognitoUserPools: [props.userPool],
      authorizerName: `CantiereSnap-${props.environment}-authorizer`,
    });

    const auth: apigateway.MethodOptions = {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    const int = (fn: lambda.IFunction) =>
      new apigateway.LambdaIntegration(fn, { proxy: true });

    // ── /auth  (no authorizer — public) ─────────────────────────────────────
    const authRes = api.root.addResource('auth');
    authRes.addResource('register').addMethod('POST', int(authFn));
    authRes.addResource('verify').addMethod('POST', int(authFn));
    authRes.addResource('login').addMethod('POST', int(authFn));
    authRes.addResource('refresh').addMethod('POST', int(authFn));

    // ── /profile ─────────────────────────────────────────────────────────────
    const profileRes = api.root.addResource('profile');
    profileRes.addMethod('GET', int(authFn), auth);
    profileRes.addMethod('PUT', int(authFn), auth);

    // ── /clients ─────────────────────────────────────────────────────────────
    const clientsRes = api.root.addResource('clients');
    clientsRes.addMethod('POST', int(clientsFn), auth);
    clientsRes.addMethod('GET', int(clientsFn), auth);
    const clientRes = clientsRes.addResource('{clientId}');
    clientRes.addMethod('GET', int(clientsFn), auth);
    clientRes.addMethod('PUT', int(clientsFn), auth);

    // ── /jobs ─────────────────────────────────────────────────────────────────
    const jobsRes = api.root.addResource('jobs');
    jobsRes.addMethod('POST', int(jobsFn), auth);
    jobsRes.addMethod('GET', int(jobsFn), auth);

    const jobRes = jobsRes.addResource('{jobId}');
    jobRes.addMethod('GET', int(jobsFn), auth);
    jobRes.addResource('details').addMethod('GET', int(jobsFn), auth);
    jobRes.addResource('status').addMethod('PATCH', int(jobsFn), auth);

    // /jobs/{jobId}/quote
    const quoteRes = jobRes.addResource('quote');
    quoteRes.addResource('generate').addMethod('POST', int(quotesFn), auth);
    quoteRes.addMethod('GET', int(quotesFn), auth);
    const quoteItemsRes = quoteRes.addResource('items');
    quoteItemsRes.addMethod('POST', int(quotesFn), auth);
    const quoteItemRes = quoteItemsRes.addResource('{seq}');
    quoteItemRes.addMethod('PUT', int(quotesFn), auth);
    quoteItemRes.addMethod('DELETE', int(quotesFn), auth);
    quoteRes.addResource('finalize').addMethod('POST', int(quotesFn), auth);
    quoteRes.addResource('send').addMethod('POST', int(quotesFn), auth);

    // /jobs/{jobId}/photos
    const photosRes = jobRes.addResource('photos');
    photosRes.addResource('upload-url').addMethod('POST', int(photosFn), auth);
    photosRes.addMethod('POST', int(photosFn), auth);
    photosRes.addMethod('GET', int(photosFn), auth);
    const photoRes = photosRes.addResource('{photoId}');
    photoRes.addMethod('GET', int(photosFn), auth);
    photoRes.addMethod('PATCH', int(photosFn), auth);
    photoRes.addMethod('DELETE', int(photosFn), auth);

    // /jobs/{jobId}/materials
    const materialsRes = jobRes.addResource('materials');
    materialsRes.addResource('scan').addMethod('POST', int(ocrFn), auth);
    materialsRes.addMethod('GET', int(ocrFn), auth);
    materialsRes.addMethod('POST', int(ocrFn), auth);
    materialsRes.addResource('{materialId}').addMethod('PUT', int(ocrFn), auth);

    // /jobs/{jobId}/invoice
    const invoiceRes = jobRes.addResource('invoice');
    invoiceRes.addMethod('POST', int(invoicesFn), auth);
    invoiceRes.addMethod('GET', int(invoicesFn), auth);
    invoiceRes.addResource('status').addMethod('PATCH', int(invoicesFn), auth);
    invoiceRes.addResource('send').addMethod('POST', int(invoicesFn), auth);

    // /jobs/{jobId}/notify/sms
    jobRes.addResource('notify').addResource('sms').addMethod('POST', int(notificationsFn), auth);

    // ── /invoices (list all) ─────────────────────────────────────────────────
    api.root.addResource('invoices').addMethod('GET', int(invoicesFn), auth);

    // ── /dashboard ───────────────────────────────────────────────────────────
    const dashboardRes = api.root.addResource('dashboard');
    dashboardRes.addResource('summary').addMethod('GET', int(dashboardFn), auth);
    dashboardRes.addResource('revenue').addMethod('GET', int(dashboardFn), auth);
    dashboardRes.addResource('jobs-stats').addMethod('GET', int(dashboardFn), auth);
    dashboardRes.addResource('overdue').addMethod('GET', int(dashboardFn), auth);

    // ── /notifications ────────────────────────────────────────────────────────
    api.root.addResource('notifications').addMethod('GET', int(notificationsFn), auth);
  }
}
