import { Aws, CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { EventField, RuleTargetInput } from 'aws-cdk-lib/aws-events';
import { Effect, ManagedPolicy, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { DefinitionBody, Fail, StateMachine, Succeed } from 'aws-cdk-lib/aws-stepfunctions';
import { LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import type { Construct } from 'constructs';
import { join } from 'path';
import { S3EventBridgeStepFunction } from './s3eventbridge-stepfunction';

const rootDir = `${__dirname}/..`;

export class InfrastructureStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create a single private S3 bucket for both PDFs and HTML outputs
    const contentBucket = new Bucket(this, 'ContentAccessibilityBucket', {
      bucketName: `content-accessibility-${Aws.ACCOUNT_ID}-${Aws.REGION}`,
      removalPolicy: RemovalPolicy.DESTROY, // For development - change for production
      autoDeleteObjects: true, // For development - change for production
      versioned: false,
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL, // Private bucket
      publicReadAccess: false,
    });

    // Create IAM role for Lambda functions
    const lambdaExecutionRole = new Role(this, 'ContentAccessibilityLambdaRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
      inlinePolicies: {
        S3Access: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:ListBucket'],
              resources: [contentBucket.bucketArn, `${contentBucket.bucketArn}/*`],
            }),
          ],
        }),
        BedrockAccess: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ['bedrock-data-automation:*', 'bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
              resources: ['*'], // Bedrock resources are region-specific
            }),
          ],
        }),
      },
    });

    // Create Lambda function for PDF to HTML conversion processing
    const pdfConverterFunction = new NodejsFunction(this, 'PdfConverterFunction', {
      depsLockFilePath: `${rootDir}/bun.lock`,
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.minutes(15),
      memorySize: 256,
      role: lambdaExecutionRole,
      environment: {
        CONTENT_BUCKET: contentBucket.bucketName,
      },
      entry: `${rootDir}/lib/lambdas/pdf-converter.ts`,
      bundling: {
        banner: "import { createRequire } from 'module';const require = createRequire(import.meta.url);",
        minify: true,
        format: OutputFormat.ESM,
        tsconfig: `${rootDir}/tsconfig.json`,
        sourceMap: true,
        mainFields: ['module', 'main'],
        externalModules: ['@aws-sdk/client-s3', 'aws-lambda'],
      },
    });

    // Create Lambda function for error handling and cleanup
    const errorHandlerFunction = new NodejsFunction(this, 'ErrorHandlerFunction', {
      depsLockFilePath: `${rootDir}/bun.lock`,
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.minutes(15),
      memorySize: 256,
      role: lambdaExecutionRole,
      environment: {
        CONTENT_BUCKET: contentBucket.bucketName,
      },
      entry: `${rootDir}/lib/lambdas/error-handler.ts`,
      bundling: {
        banner: "import { createRequire } from 'module';const require = createRequire(import.meta.url);",
        minify: true,
        format: OutputFormat.ESM,
        tsconfig: `${rootDir}/tsconfig.json`,
        sourceMap: true,
        mainFields: ['module', 'main'],
        externalModules: ['@aws-sdk/client-s3', 'aws-lambda'],
      },
    });

    // Define Step Function states with proper error handling
    const convertPdfTask = new LambdaInvoke(this, 'ConvertPdfToHtml', {
      lambdaFunction: pdfConverterFunction,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });

    // Add retry configuration to the convert task
    convertPdfTask.addRetry({
      errors: ['Lambda.ServiceException', 'Lambda.AWSLambdaException', 'Lambda.SdkClientException'],
      interval: Duration.seconds(2),
      maxAttempts: 3,
      backoffRate: 2.0,
    });

    const handleErrorTask = new LambdaInvoke(this, 'HandleError', {
      lambdaFunction: errorHandlerFunction,
      outputPath: '$.Payload',
    });

    const successState = new Succeed(this, 'ConversionSuccess', {
      comment: 'PDF to HTML conversion completed successfully',
    });

    const failState = new Fail(this, 'ConversionFailed', {
      comment: 'PDF to HTML conversion failed after retries',
    });

    // Create the Step Function definition with error handling
    convertPdfTask.addCatch(handleErrorTask, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    const definition = convertPdfTask.next(successState);

    handleErrorTask.next(failState);

    // Create the Step Function
    const stepFunction = new StateMachine(this, 'ContentAccessibilityStateMachine', {
      definitionBody: DefinitionBody.fromChainable(definition),
    });

    // Grant Step Function permission to invoke Lambda functions
    pdfConverterFunction.grantInvoke(stepFunction);
    errorHandlerFunction.grantInvoke(stepFunction);

    const pattern = new S3EventBridgeStepFunction(this, 'pattern', {
      sourceBucket: contentBucket,
      stateMachine: stepFunction,
      stateMachineInput: RuleTargetInput.fromObject({
        input: EventField.fromPath('$'),
      }),
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: {
            name: [contentBucket.bucketName],
          },
          object: { key: [{ wildcard: 'pdfs/*.pdf' }] },
        },
      },
    });

    // Output important values
    new CfnOutput(this, 'ContentBucketName', {
      value: contentBucket.bucketName,
      description: 'S3 bucket for PDF inputs (pdfs/) and HTML outputs (htmls/)',
    });

    new CfnOutput(this, 'StepFunctionArn', {
      value: stepFunction.stateMachineArn,
      description: 'ARN of the Step Function for PDF to HTML conversion',
    });

    new CfnOutput(this, 'PdfConverterFunctionName', {
      value: pdfConverterFunction.functionName,
      description: 'Name of the PDF converter Lambda function',
    });

    new CfnOutput(this, 'EventBridgeRuleArn', {
      value: pattern.eventRule.ruleArn,
    });
  }
}
