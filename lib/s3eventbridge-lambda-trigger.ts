import { type EventPattern, Rule, type RuleTargetInput } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import type { IBucket } from 'aws-cdk-lib/aws-s3';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import type { IStateMachine } from 'aws-cdk-lib/aws-stepfunctions';
import { Construct } from 'constructs';

export interface S3EventBridgeLambdaTriggerProps {
  deadLetterQueue?: boolean;
  eventPattern?: EventPattern;
  sourceBucket: IBucket;
  triggerFunction: IFunction;
}

export class S3EventBridgeLambdaTrigger extends Construct {
  public readonly eventRule: Rule;

  constructor(scope: Construct, id: string, props: S3EventBridgeLambdaTriggerProps) {
    const { deadLetterQueue, eventPattern, sourceBucket, triggerFunction } = props;
    super(scope, id);

    sourceBucket.enableEventBridgeNotification();

    this.eventRule = new Rule(this, 'EventRule');

    this.eventRule.addEventPattern(
      eventPattern ?? {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: {
            name: [sourceBucket.bucketName],
          },
        },
      },
    );

    const eventRole = new Role(this, 'EventRole', {
      assumedBy: new ServicePrincipal('events.amazonaws.com'),
    });

    triggerFunction.grantInvoke(eventRole);

    this.eventRule.addTarget(
      new LambdaFunction(triggerFunction, {
        deadLetterQueue: deadLetterQueue
          ? new Queue(this, 'DeadLetterQueue', {
              encryption: QueueEncryption.SQS_MANAGED,
              enforceSSL: true,
            })
          : undefined,
      }),
    );
  }
}

// Keep the original for backwards compatibility but deprecate it
export interface S3EventBridgeStepFunctionProps {
  deadLetterQueue?: boolean;
  eventPattern?: EventPattern;
  sourceBucket: IBucket;
  stateMachine: IStateMachine;
  stateMachineInput: RuleTargetInput;
}

export class S3EventBridgeStepFunction extends Construct {
  public readonly eventRule: Rule;

  constructor(scope: Construct, id: string, props: S3EventBridgeStepFunctionProps) {
    super(scope, id);

    // This construct is now deprecated in favor of the Lambda trigger approach
    // But we keep it for backwards compatibility
    console.warn('S3EventBridgeStepFunction is deprecated. Use S3EventBridgeLambdaTrigger instead.');

    const { sourceBucket } = props;
    
    sourceBucket.enableEventBridgeNotification();

    this.eventRule = new Rule(this, 'EventRule');

    this.eventRule.addEventPattern({
      source: ['aws.s3'],
      detailType: ['Object Created'],
      detail: {
        bucket: {
          name: [sourceBucket.bucketName],
        },
      },
    });

    // This construct now does minimal setup since we're using Lambda triggers
  }
}