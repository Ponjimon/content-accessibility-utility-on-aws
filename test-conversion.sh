#!/bin/bash

# Example script to test the PDF to HTML conversion Step Function workflow
# This script demonstrates the simplified event-driven architecture

# Set your AWS region and account ID
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT="${AWS_ACCOUNT:-$(aws sts get-caller-identity --query Account --output text)}"

# Stack outputs (these will be available after deployment)
CONTENT_BUCKET="content-accessibility-${AWS_ACCOUNT}-${AWS_REGION}"
STATE_MACHINE_ARN="arn:aws:states:${AWS_REGION}:${AWS_ACCOUNT}:stateMachine:UpdatedContentAccessibilityStateMachine"

# Test parameters
JOB_ID="test-job-$(date +%Y%m%d-%H%M%S)"
TEST_PDF="${1:-sample.pdf}"

echo "🚀 Testing PDF to HTML conversion with multi-step Step Function workflow"
echo "Region: $AWS_REGION"
echo "Account: $AWS_ACCOUNT"
echo "Content Bucket: $CONTENT_BUCKET"
echo "Test PDF: $TEST_PDF"
echo ""

# Check if PDF file exists
if [ ! -f "$TEST_PDF" ]; then
    echo "❌ PDF file '$TEST_PDF' not found!"
    echo "Please provide a PDF file as the first argument, or create a sample.pdf file"
    exit 1
fi

# Upload PDF to trigger automatic conversion
echo "📤 Uploading PDF to pdfs/ prefix to trigger automatic conversion..."
aws s3 cp "$TEST_PDF" "s3://${CONTENT_BUCKET}/pdfs/" --region "$AWS_REGION"

if [ $? -ne 0 ]; then
    echo "❌ Failed to upload PDF to S3"
    exit 1
fi

PDF_S3_KEY="pdfs/$(basename "$TEST_PDF")"
echo "✅ PDF uploaded successfully to: s3://${CONTENT_BUCKET}/${PDF_S3_KEY}"
echo ""

echo "🔄 The Step Function workflow will be triggered automatically by S3 EventBridge notification..."
echo "Workflow steps:"
echo "  1. 🔄 PDF Processing - Validate input, download, convert to accessible HTML, upload results, and cleanup"
echo "  2. ✅ Success or comprehensive error handling"
echo ""

# Wait a moment for the trigger to process
echo "⏳ Waiting for automatic workflow to start..."
sleep 10

# Try to find recent executions
echo "🔍 Looking for recent Step Function executions..."
RECENT_EXECUTIONS=$(aws stepfunctions list-executions \
    --state-machine-arn "$STATE_MACHINE_ARN" \
    --region "$AWS_REGION" \
    --max-items 5 \
    --query 'executions[?startDate>=`2025-01-02`].{name:name,status:status,arn:executionArn}' \
    --output table)

echo "$RECENT_EXECUTIONS"

# Get the most recent execution
LATEST_EXECUTION=$(aws stepfunctions list-executions \
    --state-machine-arn "$STATE_MACHINE_ARN" \
    --region "$AWS_REGION" \
    --max-items 1 \
    --query 'executions[0].executionArn' \
    --output text)

if [ "$LATEST_EXECUTION" != "None" ] && [ "$LATEST_EXECUTION" != "" ]; then
    echo ""
    echo "📊 Monitoring latest execution: $LATEST_EXECUTION"
    
    # Monitor the execution
    while true; do
        STATUS=$(aws stepfunctions describe-execution \
            --execution-arn "$LATEST_EXECUTION" \
            --region "$AWS_REGION" \
            --query 'status' \
            --output text)
        
        case "$STATUS" in
            "SUCCEEDED")
                echo "✅ Workflow completed successfully!"
                
                # Show execution history summary
                echo ""
                echo "📋 Execution Summary:"
                aws stepfunctions get-execution-history \
                    --execution-arn "$LATEST_EXECUTION" \
                    --region "$AWS_REGION" \
                    --query 'events[?type==`LambdaFunctionSucceeded`].{step:previousEventId,timestamp:timestamp}' \
                    --output table
                break
                ;;
            "FAILED"|"TIMED_OUT"|"ABORTED")
                echo "❌ Workflow failed with status: $STATUS"
                
                # Get failure details
                echo ""
                echo "🔍 Failure Details:"
                aws stepfunctions get-execution-history \
                    --execution-arn "$LATEST_EXECUTION" \
                    --region "$AWS_REGION" \
                    --query 'events[?type==`ExecutionFailed` || type==`LambdaFunctionFailed`]' \
                    --output table
                exit 1
                ;;
            "RUNNING")
                echo "🔄 Workflow is running... (Status: $STATUS)"
                sleep 10
                ;;
            *)
                echo "🔄 Status: $STATUS"
                sleep 5
                ;;
        esac
    done
else
    echo "⚠️  No recent executions found. The trigger may take a few more moments to process the S3 event."
    echo "   Check the Step Functions console to monitor the execution manually:"
    echo "   https://${AWS_REGION}.console.aws.amazon.com/states/home?region=${AWS_REGION}#/statemachines"
fi

# Check the output regardless of execution status
echo ""
echo "📥 Checking for output files..."
OUTPUT_FILES=$(aws s3 ls "s3://${CONTENT_BUCKET}/htmls/" --region "$AWS_REGION" --recursive)

if [ -n "$OUTPUT_FILES" ]; then
    echo "✅ Output files found:"
    echo "$OUTPUT_FILES"
    
    # Download the converted files for inspection
    echo ""
    echo "📁 Downloading converted files..."
    mkdir -p "output/$(basename "$TEST_PDF" .pdf)"
    aws s3 sync "s3://${CONTENT_BUCKET}/htmls/" "output/$(basename "$TEST_PDF" .pdf)/" --region "$AWS_REGION"
    
    echo ""
    echo "🎉 Test completed!"
    echo "Input: s3://${CONTENT_BUCKET}/${PDF_S3_KEY}"
    echo "Output: s3://${CONTENT_BUCKET}/htmls/"
    echo "Local files: output/$(basename "$TEST_PDF" .pdf)/"
else
    echo "⚠️  No output files found yet. The conversion may still be in progress."
    echo "   Check again in a few minutes or monitor the Step Function execution."
fi

echo ""
echo "🔗 Useful links:"
echo "📊 Step Functions Console: https://${AWS_REGION}.console.aws.amazon.com/states/home?region=${AWS_REGION}#/statemachines"
echo "🪣 S3 Console: https://s3.console.aws.amazon.com/s3/buckets/${CONTENT_BUCKET}/"
echo "📈 CloudWatch Logs: https://${AWS_REGION}.console.aws.amazon.com/cloudwatch/home?region=${AWS_REGION}#logsV2:log-groups"