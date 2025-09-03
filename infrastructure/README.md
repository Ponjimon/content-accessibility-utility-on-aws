# Content Accessibility Utility - PDF to HTML CDK Stack

This CDK stack creates AWS infrastructure for converting PDF documents to HTML using AWS Step Functions, Lambda, and S3. It's designed to work alongside the existing Content Accessibility Utility Python package.

## Architecture

The stack creates the following AWS resources:

### Core Infrastructure
- **Step Functions State Machine**: Orchestrates the PDF to HTML conversion workflow
- **Lambda Functions**: 
  - PDF Processor: Downloads PDF from S3, converts to HTML, uploads result
  - Status Checker: Monitors conversion progress (for future async workflows)
- **S3 Buckets**:
  - Input bucket: Stores PDF files to be converted
  - Output bucket: Stores converted HTML files and assets
- **IAM Roles**: Secure permissions for Lambda functions to access S3 and Bedrock services
- **CloudWatch Logs**: Centralized logging for Step Functions execution

### Workflow

1. **Input**: PDF file uploaded to the input S3 bucket
2. **Processing**: Step Function triggers Lambda function to:
   - Download PDF from input bucket
   - Convert PDF to accessible HTML (currently a demo implementation)
   - Upload HTML result to output bucket
3. **Output**: Accessible HTML file available in the output bucket

## Deployment

### Prerequisites

1. AWS CLI configured with appropriate permissions
2. Node.js and npm installed
3. AWS CDK CLI installed globally: `npm install -g aws-cdk`

### Deploy the Stack

```bash
cd infrastructure
npm install
npm run build
cdk bootstrap  # If not already done for your account/region
cdk deploy
```

### Stack Outputs

After deployment, the stack provides:
- `InputBucketName`: S3 bucket name for PDF uploads
- `OutputBucketName`: S3 bucket name for HTML outputs
- `StateMachineArn`: Step Function ARN for triggering conversions
- `ProcessorFunctionName`: Lambda function name for direct invocation

## Usage

### 1. Upload a PDF file to the input bucket

```bash
aws s3 cp your-document.pdf s3://content-accessibility-pdf-input-{account}-{region}/
```

### 2. Trigger the Step Function

```bash
aws stepfunctions start-execution \
  --state-machine-arn "arn:aws:states:region:account:stateMachine:content-accessibility-pdf-to-html" \
  --input '{
    "jobId": "test-job-001",
    "inputS3Bucket": "content-accessibility-pdf-input-{account}-{region}",
    "inputS3Key": "your-document.pdf",
    "outputS3Bucket": "content-accessibility-html-output-{account}-{region}",
    "outputS3Prefix": "converted/",
    "conversionOptions": {
      "single_file": true,
      "extract_images": true,
      "image_format": "png"
    }
  }'
```

### 3. Check the results

```bash
aws s3 ls s3://content-accessibility-html-output-{account}-{region}/converted/test-job-001/
```

## Current Implementation

This is a **demonstration implementation** that creates a basic HTML output. The actual PDF conversion is currently a placeholder that:

- Downloads the PDF file from S3
- Creates a sample HTML page with metadata about the conversion
- Uploads the HTML result to the output bucket

## Integration with Content Accessibility Utility

To integrate with the existing Python package's PDF conversion capabilities:

1. **Lambda Layer**: Create a Lambda layer containing the `content_accessibility_utility_on_aws` package
2. **Enhanced Lambda Function**: Update the processor Lambda to use the actual conversion APIs:
   ```python
   from content_accessibility_utility_on_aws.batch.pdf2html import process_pdf_document
   
   # Use the existing conversion logic
   result = process_pdf_document(
       job_id=job_id,
       source_bucket=input_bucket,
       source_key=input_key,
       destination_bucket=output_bucket,
       options=conversion_options
   )
   ```
3. **BDA Configuration**: Ensure the Lambda has access to the Bedrock Data Automation project ARN

## AWS Best Practices Implemented

- **Security**: 
  - Least privilege IAM roles
  - S3 buckets with encryption and blocked public access
  - No hardcoded credentials
- **Monitoring**: 
  - CloudWatch logging for all components
  - Step Function execution history
- **Cost Optimization**:
  - Appropriate Lambda memory sizing
  - S3 lifecycle policies (can be added)
- **Reliability**:
  - Error handling in Lambda functions
  - Step Function timeout configuration
  - Proper resource cleanup

## Development

### Local Testing

```bash
# Build the TypeScript
npm run build

# Run tests
npm test

# Synthesize CloudFormation without deployment
cdk synth

# Show differences with deployed stack
cdk diff
```

### Clean Up

To remove all resources:

```bash
cdk destroy
```

**Note**: S3 buckets with objects will need to be emptied first, or you can use the `autoDeleteObjects: true` setting (already configured for development).

## Future Enhancements

1. **Async Processing**: Add SQS queues for handling large batches of PDFs
2. **Status Polling**: Implement the status checker Lambda for long-running conversions
3. **Error Handling**: Add retry logic and dead letter queues
4. **Monitoring**: Add CloudWatch dashboards and alarms
5. **API Gateway**: Add REST API endpoints for triggering conversions
6. **Event-Driven**: Use S3 event notifications to auto-trigger conversions
