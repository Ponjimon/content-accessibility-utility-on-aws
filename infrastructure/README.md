# Content Accessibility Utility - CDK Infrastructure

This CDK stack creates AWS infrastructure for automatically converting PDF files to accessible HTML using the Content Accessibility Utility on AWS framework.

## Architecture

The stack creates a serverless architecture that automatically triggers PDF to HTML conversion when PDF files are uploaded to an S3 bucket.

### Components

- **Single Private S3 Bucket**: Stores both input PDFs (`pdfs/`) and output HTML files (`htmls/`)
- **S3 Event Trigger**: Automatically triggers processing when PDFs are uploaded to `pdfs/*.pdf`
- **Step Function**: Orchestrates the conversion workflow with proper error handling
- **Lambda Functions**:
  - **Trigger Function**: Receives S3 events and starts Step Function executions
  - **PDF Converter Function**: Downloads PDFs, converts to HTML, uploads results
  - **Error Handler Function**: Handles errors and creates detailed error reports
- **IAM Roles**: Proper permissions for S3, Bedrock, and Step Functions access
- **CloudWatch Logging**: Comprehensive logging for monitoring and debugging

### Workflow

1. User uploads a PDF file to `s3://bucket-name/pdfs/document.pdf`
2. S3 event notification triggers the Trigger Lambda function
3. Trigger function starts a Step Function execution
4. Step Function invokes the PDF Converter Lambda with retry logic
5. PDF Converter downloads the PDF, converts it to accessible HTML, and uploads to `s3://bucket-name/htmls/document.html`
6. If errors occur, the Error Handler Lambda creates detailed error reports

## Prerequisites

- **Bun**: This project uses Bun instead of npm for package management
- **AWS CLI**: Configured with appropriate credentials
- **CDK Bootstrap**: Your AWS account/region must be bootstrapped for CDK

## Installation

```bash
# Install Bun if not already installed
curl -fsSL https://bun.sh/install | bash

# Install dependencies
bun install
```

## Building

```bash
# Build TypeScript code and Lambda functions
bun run build

# Watch for changes during development
bun run watch
```

## Testing

```bash
# Run CDK stack tests
bun run test
```

## Deployment

```bash
# Synthesize the CloudFormation template
bun run synth

# Deploy the stack
bun run deploy

# Destroy the stack (when no longer needed)
bun run destroy
```

## Usage

After deployment:

1. **Upload PDF files** to the `pdfs/` prefix in the created S3 bucket:
   ```bash
   aws s3 cp document.pdf s3://content-accessibility-[account]-[region]/pdfs/
   ```

2. **Monitor processing** via CloudWatch logs or Step Functions console

3. **Download converted HTML** from the `htmls/` prefix:
   ```bash
   aws s3 cp s3://content-accessibility-[account]-[region]/htmls/document.html .
   ```

## Configuration

The stack creates the following outputs:
- **ContentBucketName**: S3 bucket for PDF inputs and HTML outputs
- **StepFunctionArn**: ARN of the Step Function for monitoring
- **PdfConverterFunctionName**: Name of the PDF converter Lambda function
- **TriggerFunctionName**: Name of the S3 trigger Lambda function

## Error Handling

The Step Function includes comprehensive error handling:
- **Automatic retries** for transient failures
- **Error reporting** to S3 with detailed diagnostics
- **Failed execution tracking** via CloudWatch

Error reports are saved to:
- JSON format: `s3://bucket/errors/job-id-error-report.json`
- HTML format: `s3://bucket/htmls/error-job-id.html`

## Monitoring

Monitor the system via:
- **CloudWatch Logs**: `/aws/stepfunctions/content-accessibility-pdf-to-html`
- **Step Functions Console**: View execution history and errors
- **Lambda Metrics**: Monitor function performance and errors

## Development

### Lambda Functions

Lambda functions are located in `lib/lambdas/`:
- `trigger.ts`: S3 event handler
- `pdf-converter.ts`: PDF to HTML conversion logic
- `error-handler.ts`: Error handling and reporting

### CDK Stack

The main CDK stack is in `lib/infrastructure-stack.ts` and includes:
- Resource definitions
- IAM permissions
- Event notifications
- Step Function workflow

### Testing

Tests are in `test/infrastructure.test.ts` and verify:
- Stack synthesis without errors
- Basic CDK functionality

## Key Changes from Previous Implementation

This new implementation addresses all requirements:

✅ **Uses Bun instead of npm** - All scripts use `bunx` instead of `npx`
✅ **Single private S3 bucket** - Replaces separate input/output buckets
✅ **Event-driven triggering** - S3 events automatically trigger processing
✅ **TypeScript Lambda functions** - All Lambdas use `NodejsFunction` construct
✅ **Proper error handling** - Step Function includes retry logic and error states
✅ **Correct file organization** - PDFs in `pdfs/` folder, HTML in `htmls/` folder

## Current Implementation

This implementation includes:
- **Sample HTML conversion**: Creates accessible HTML with proper structure
- **S3 event handling**: Automatic triggering on PDF uploads
- **Comprehensive error handling**: Detailed error reports and recovery
- **Full CDK integration**: Ready for deployment and production use

## Future Integration

To integrate with the full Python package functionality:
1. Add Python runtime Lambda layer with the content accessibility package
2. Update the PDF converter to call the actual Python conversion APIs
3. Configure Bedrock Data Automation access for full PDF processing

## Contributing

1. Make changes to the TypeScript code
2. Run `bun run build` to compile
3. Run `bun run test` to verify
4. Run `bun run synth` to generate CloudFormation
5. Test deployment in a development account

## Troubleshooting

### Common Issues

1. **Lock file errors**: Ensure `package-lock.json` exists for CDK bundling
2. **Permission errors**: Verify AWS credentials and CDK bootstrap
3. **Build errors**: Check TypeScript compilation with `bun run build`
4. **Deployment errors**: Review CloudFormation events in AWS console

### Logs

Check CloudWatch logs for each component:
- Step Functions: `/aws/stepfunctions/content-accessibility-pdf-to-html`
- Lambda functions: `/aws/lambda/[function-name]`