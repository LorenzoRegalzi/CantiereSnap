import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';

interface FrontendStackProps extends cdk.StackProps {
  environment: string;
}

export class FrontendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    const isProd = props.environment === 'production';

    // ── S3 bucket — private, CloudFront-only access via OAC ─────────────────
    const bucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: `cantieresnap-frontend-${props.environment}-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
    });

    // ── Cache policies ───────────────────────────────────────────────────────

    // HTML files: use the built-in CACHING_DISABLED policy (gzip flags not allowed with TTL=0)
    const htmlCachePolicy = cloudfront.CachePolicy.CACHING_DISABLED;

    // Static assets: fingerprinted by Next.js (_next/static/), safe to cache 1 year
    const staticAssetCachePolicy = new cloudfront.CachePolicy(this, 'StaticCachePolicy', {
      cachePolicyName: `cantieresnap-static-${props.environment}`,
      defaultTtl: cdk.Duration.days(365),
      minTtl: cdk.Duration.days(365),
      maxTtl: cdk.Duration.days(365),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    // ── CloudFront distribution ──────────────────────────────────────────────
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `CantiereSnap frontend (${props.environment})`,

      // Default origin: S3 bucket via OAC (bucket policy added automatically)
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: htmlCachePolicy,
        compress: true,
      },

      // /_next/static/* and /_next/image/* — content-hashed, cache 1 year
      additionalBehaviors: {
        '/_next/*': {
          origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: staticAssetCachePolicy,
          compress: true,
        },
      },

      defaultRootObject: 'index.html',

      // SPA routing: S3 returns 403 (key not found with OAC) → serve index.html
      // 404 fallback included for safety
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],

      // Cheapest price class — Europe + North America only
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,

      // Default CloudFront certificate (*.cloudfront.net) — no custom domain
      // httpVersion defaults to HTTP2
    });

    // ── Outputs ──────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'CloudFrontUrl', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'CantiereSnap frontend URL',
      exportName: `CantiereSnap-FrontendStack-${props.environment}-CloudFrontUrl`,
    });

    new cdk.CfnOutput(this, 'S3BucketName', {
      value: bucket.bucketName,
      description: 'S3 bucket for frontend static files',
      exportName: `CantiereSnap-FrontendStack-${props.environment}-S3BucketName`,
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront distribution ID — needed for cache invalidation',
      exportName: `CantiereSnap-FrontendStack-${props.environment}-DistributionId`,
    });
  }
}
