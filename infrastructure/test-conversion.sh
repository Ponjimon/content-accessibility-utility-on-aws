#!/bin/bash

# Example script to test the PDF to HTML conversion Step Function
# This script assumes the CDK stack has been deployed

# Set your AWS region and account ID
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT="${AWS_ACCOUNT:-$(aws sts get-caller-identity --query Account --output text)}"

# Stack outputs (these will be available after deployment)
INPUT_BUCKET="content-accessibility-pdf-input-${AWS_ACCOUNT}-${AWS_REGION}"
OUTPUT_BUCKET="content-accessibility-html-output-${AWS_ACCOUNT}-${AWS_REGION}"
STATE_MACHINE_ARN="arn:aws:states:${AWS_REGION}:${AWS_ACCOUNT}:stateMachine:content-accessibility-pdf-to-html"

# Test parameters
JOB_ID="test-job-$(date +%Y%m%d-%H%M%S)"
TEST_PDF="${1:-sample.pdf}"

echo "🚀 Testing PDF to HTML conversion with CDK Stack"
echo "Region: $AWS_REGION"
echo "Account: $AWS_ACCOUNT"
echo "Job ID: $JOB_ID"
echo "Test PDF: $TEST_PDF"
echo ""

# Check if PDF file exists
if [ ! -f "$TEST_PDF" ]; then
    echo "❌ PDF file '$TEST_PDF' not found!"
    echo "Please provide a PDF file as the first argument, or create a sample.pdf file"
    exit 1
fi

# Upload PDF to input bucket
echo "📤 Uploading PDF to input bucket..."
aws s3 cp "$TEST_PDF" "s3://${INPUT_BUCKET}/" --region "$AWS_REGION"

if [ $? -ne 0 ]; then
    echo "❌ Failed to upload PDF to S3"
    exit 1
fi

echo "✅ PDF uploaded successfully"

# Create Step Function input
INPUT_JSON=$(cat <<EOF
{
    "jobId": "$JOB_ID",
    "inputS3Bucket": "$INPUT_BUCKET",
    "inputS3Key": "$(basename "$TEST_PDF")",
    "outputS3Bucket": "$OUTPUT_BUCKET",
    "outputS3Prefix": "converted/",
    "conversionOptions": {
        "single_file": true,
        "extract_images": true,
        "image_format": "png"
    }
}
EOF
)

echo "🔄 Starting Step Function execution..."
EXECUTION_ARN=$(aws stepfunctions start-execution \
    --state-machine-arn "$STATE_MACHINE_ARN" \
    --name "execution-$JOB_ID" \
    --input "$INPUT_JSON" \
    --region "$AWS_REGION" \
    --query 'executionArn' \
    --output text)

if [ $? -ne 0 ]; then
    echo "❌ Failed to start Step Function execution"
    exit 1
fi

echo "✅ Step Function execution started: $EXECUTION_ARN"

# Wait for execution to complete
echo "⏳ Waiting for execution to complete..."
while true; do
    STATUS=$(aws stepfunctions describe-execution \
        --execution-arn "$EXECUTION_ARN" \
        --region "$AWS_REGION" \
        --query 'status' \
        --output text)
    
    case "$STATUS" in
        "SUCCEEDED")
            echo "✅ Execution completed successfully!"
            break
            ;;
        "FAILED"|"TIMED_OUT"|"ABORTED")
            echo "❌ Execution failed with status: $STATUS"
            # Get execution history for debugging
            aws stepfunctions get-execution-history \
                --execution-arn "$EXECUTION_ARN" \
                --region "$AWS_REGION" \
                --query 'events[?type==`ExecutionFailed`].executionFailedEventDetails'
            exit 1
            ;;
        "RUNNING")
            echo "🔄 Still running..."
            sleep 5
            ;;
        *)
            echo "🔄 Status: $STATUS"
            sleep 5
            ;;
    esac
done

# Check the output
echo "📥 Checking output files..."
aws s3 ls "s3://${OUTPUT_BUCKET}/converted/${JOB_ID}/" --region "$AWS_REGION" --recursive

# Download the converted HTML for inspection
echo "📁 Downloading converted HTML..."
mkdir -p "output/$JOB_ID"
aws s3 sync "s3://${OUTPUT_BUCKET}/converted/${JOB_ID}/" "output/$JOB_ID/" --region "$AWS_REGION"

echo ""
echo "🎉 Test completed successfully!"
echo "Output files are available in: output/$JOB_ID/"
echo "S3 location: s3://${OUTPUT_BUCKET}/converted/${JOB_ID}/"