import { type EventPattern, Rule, type RuleTargetInput } from 'aws-cdk-lib/aws-events';
import { SfnStateMachine } from 'aws-cdk-lib/aws-events-targets';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import type { IBucket } from 'aws-cdk-lib/aws-s3';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import type { IStateMachine } from 'aws-cdk-lib/aws-stepfunctions';
import { Construct } from 'constructs';

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
    const { deadLetterQueue, eventPattern, sourceBucket, stateMachine, stateMachineInput } = props;
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

    stateMachine.grantStartExecution(eventRole);

    this.eventRule.addTarget(
      new SfnStateMachine(stateMachine, {
        input: stateMachineInput,
        role: eventRole,
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
