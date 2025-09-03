import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as stepfunctionTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';

export class InfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const rootDir = path.resolve(__dirname, '..');

    // Create S3 buckets for input and output
    const inputBucket = new s3.Bucket(this, 'PdfInputBucket', {
      bucketName: `content-accessibility-pdf-input-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For development - change for production
      autoDeleteObjects: true, // For development - change for production
      versioned: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    const outputBucket = new s3.Bucket(this, 'HtmlOutputBucket', {
      bucketName: `content-accessibility-html-output-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For development - change for production
      autoDeleteObjects: true, // For development - change for production
      versioned: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // Create IAM role for Lambda functions
    const lambdaExecutionRole = new iam.Role(this, 'PdfToHtmlLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        S3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject',
                's3:ListBucket',
              ],
              resources: [
                inputBucket.bucketArn,
                `${inputBucket.bucketArn}/*`,
                outputBucket.bucketArn,
                `${outputBucket.bucketArn}/*`,
              ],
            }),
          ],
        }),
        BedrockAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'bedrock-data-automation:*',
                'bedrock:InvokeModel',
                'bedrock:InvokeModelWithResponseStream',
              ],
              resources: ['*'], // Bedrock resources are region-specific
            }),
          ],
        }),
      },
    });

    // Create Lambda function for PDF to HTML processing using TypeScript
    const pdfProcessorFunction = new lambda.Function(this, 'PdfToHtmlProcessor', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'processor.handler',
      timeout: cdk.Duration.minutes(15), // Long timeout for PDF processing
      memorySize: 3008, // Max memory for better performance
      role: lambdaExecutionRole,
      environment: {
        INPUT_BUCKET: inputBucket.bucketName,
        OUTPUT_BUCKET: outputBucket.bucketName,
      },
      code: lambda.Code.fromAsset(path.join(rootDir, 'lib/lambdas')),
    });

    // Create Lambda function for status checking using TypeScript
    const statusCheckerFunction = new lambda.Function(this, 'PdfToHtmlStatusChecker', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'status-checker.handler',
      timeout: cdk.Duration.minutes(1),
      memorySize: 256,
      role: lambdaExecutionRole,
      environment: {
        OUTPUT_BUCKET: outputBucket.bucketName,
      },
      code: lambda.Code.fromAsset(path.join(rootDir, 'lib/lambdas')),
    });

    // Create CloudWatch Log Group for Step Function
    const stepFunctionLogGroup = new logs.LogGroup(this, 'PdfToHtmlStepFunctionLogs', {
      logGroupName: '/aws/stepfunctions/pdf-to-html-conversion',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Define Step Function tasks
    const processTask = new stepfunctionTasks.LambdaInvoke(this, 'ProcessPdfToHtml', {
      lambdaFunction: pdfProcessorFunction,
      outputPath: '$.Payload',
    });

    // For simplicity, let's create a basic workflow without the polling loop
    // In a full implementation, you could add polling for async operations
    const definition = processTask;

    // Create the Step Function
    const stepFunction = new stepfunctions.StateMachine(this, 'PdfToHtmlStateMachine', {
      stateMachineName: 'content-accessibility-pdf-to-html',
      definitionBody: stepfunctions.DefinitionBody.fromChainable(definition),
      timeout: cdk.Duration.hours(1), // Overall timeout for the workflow
      logs: {
        destination: stepFunctionLogGroup,
        level: stepfunctions.LogLevel.ALL,
      },
    });

    // Output important values
    new cdk.CfnOutput(this, 'InputBucketName', {
      value: inputBucket.bucketName,
      description: 'S3 bucket for PDF input files',
    });

    new cdk.CfnOutput(this, 'OutputBucketName', {
      value: outputBucket.bucketName,
      description: 'S3 bucket for HTML output files',
    });

    new cdk.CfnOutput(this, 'StateMachineArn', {
      value: stepFunction.stateMachineArn,
      description: 'ARN of the Step Function for PDF to HTML conversion',
    });

    new cdk.CfnOutput(this, 'ProcessorFunctionName', {
      value: pdfProcessorFunction.functionName,
      description: 'Name of the PDF processor Lambda function',
    });
  }
}
