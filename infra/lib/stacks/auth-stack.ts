import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

interface AuthStackProps extends cdk.StackProps {
  environment: string;
}

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const isProd = props.environment === 'production';

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `CantiereSnap-${props.environment}`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      userVerification: {
        emailSubject: 'Verifica il tuo account CantiereSnap',
        emailBody: 'Il tuo codice di verifica è {####}. Valido per 24 ore.',
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
      standardAttributes: {
        email: { required: true, mutable: false },
        fullname: { required: false, mutable: true },
        phoneNumber: { required: false, mutable: true },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    this.userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: `CantiereSnap-${props.environment}-client`,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      accessTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
      // Prevents leaking whether an account exists for an email (NFR-SEC-001)
      preventUserExistenceErrors: true,
      generateSecret: false,
    });
  }
}
