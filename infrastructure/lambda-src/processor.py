import json
import os
import tempfile
from typing import Dict, Any
import boto3
from urllib.parse import unquote

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Lambda handler for PDF to HTML conversion."""
    
    try:
        # Extract required parameters from event
        job_id = event.get('jobId', f"job-{context.aws_request_id}")
        input_bucket = event['inputS3Bucket']
        input_key = unquote(event['inputS3Key'])
        output_bucket = event['outputS3Bucket']
        output_prefix = event.get('outputS3Prefix', 'converted/')
        conversion_options = event.get('conversionOptions', {})
        
        print(f"Processing job {job_id}: Converting {input_bucket}/{input_key}")
        
        # Initialize AWS clients
        s3_client = boto3.client('s3')
        
        # Download PDF file to temporary location
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as temp_pdf:
            try:
                s3_client.download_file(input_bucket, input_key, temp_pdf.name)
                pdf_size = os.path.getsize(temp_pdf.name)
                print(f"Downloaded PDF file: {pdf_size} bytes")
            except Exception as e:
                raise Exception(f"Failed to download PDF: {str(e)}")
        
        # Create a simple HTML output (placeholder implementation)
        html_content = create_html_content(job_id, input_key, input_bucket, pdf_size, conversion_options, context.aws_request_id)
        
        # Upload HTML result to output bucket
        output_key = f"{output_prefix}{job_id}/converted.html"
        s3_client.put_object(
            Bucket=output_bucket,
            Key=output_key,
            Body=html_content.encode('utf-8'),
            ContentType='text/html',
            Metadata={
                'job-id': job_id,
                'source-bucket': input_bucket,
                'source-key': input_key,
                'conversion-timestamp': str(context.aws_request_id)
            }
        )
        
        # Create a simple conversion result
        conversion_result = {
            "html_path": f"s3://{output_bucket}/{output_key}",
            "output_files": [output_key],
            "pdf_pages": 1,
            "images_extracted": 0,
            "processing_time_seconds": 1.0,
        }
        
        # Construct output location
        output_location = f"s3://{output_bucket}/{output_prefix}{job_id}/"
        
        # Cleanup temporary file
        try:
            os.unlink(temp_pdf.name)
        except:
            pass
        
        # Return success response
        response = {
            "jobId": job_id,
            "status": "COMPLETED",
            "outputLocation": output_location,
            "conversionResult": conversion_result,
            "inputLocation": f"s3://{input_bucket}/{input_key}"
        }
        
        print(f"Job {job_id} completed successfully")
        return response
        
    except Exception as e:
        error_message = str(e)
        print(f"Job {job_id} failed: {error_message}")
        
        # Return failure response
        return {
            "jobId": job_id,
            "status": "FAILED",
            "error": error_message,
            "inputLocation": f"s3://{event.get('inputS3Bucket', '')}/{event.get('inputS3Key', '')}"
        }

def create_html_content(job_id, input_key, input_bucket, pdf_size, conversion_options, request_id):
    """Create HTML content for the converted document."""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Converted PDF Document</title>
    <style>
        body {{ font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; }}
        .conversion-info {{ background-color: #f0f8ff; border: 1px solid #0066cc; border-radius: 5px; padding: 15px; margin-bottom: 20px; }}
        .metadata {{ background-color: #f9f9f9; border-left: 4px solid #ccc; padding: 10px 15px; margin: 10px 0; }}
    </style>
</head>
<body>
    <div class="conversion-info">
        <h1>PDF to HTML Conversion Result</h1>
        <p><strong>Job ID:</strong> {job_id}</p>
        <p><strong>Original File:</strong> {input_key}</p>
        <p><strong>Request ID:</strong> {request_id}</p>
    </div>
    
    <div class="metadata">
        <h2>Document Metadata</h2>
        <ul>
            <li><strong>Source:</strong> s3://{input_bucket}/{input_key}</li>
            <li><strong>File Size:</strong> {pdf_size:,} bytes</li>
            <li><strong>Processing Options:</strong> {json.dumps(conversion_options, indent=2)}</li>
        </ul>
    </div>
    
    <div class="content">
        <h2>Document Content</h2>
        <p><em>This is a Step Function workflow demonstration. The actual implementation would integrate with the content accessibility utility's PDF to HTML conversion capabilities.</em></p>
        
        <p>In a full implementation, this would:</p>
        <ul>
            <li>Use AWS Bedrock Data Automation (BDA) for PDF parsing</li>
            <li>Extract text, images, and structure from the PDF</li>
            <li>Generate accessible HTML with proper semantic markup</li>
            <li>Include extracted images with appropriate alt text</li>
            <li>Preserve document layout and formatting</li>
        </ul>
    </div>
</body>
</html>"""