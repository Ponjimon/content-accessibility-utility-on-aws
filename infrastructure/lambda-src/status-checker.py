import json
import os
from typing import Dict, Any
import boto3

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Lambda handler for checking job status."""
    
    try:
        job_id = event.get('jobId', 'unknown')
        output_bucket = event['outputS3Bucket']
        output_prefix = event.get('outputS3Prefix', 'converted/')
        
        # Construct the expected output path
        job_output_prefix = f"{output_prefix}{job_id}/"
        
        print(f"Checking status for job {job_id} in {output_bucket}/{job_output_prefix}")
        
        # Initialize S3 client
        s3_client = boto3.client('s3')
        
        # List objects in the job output location
        response = s3_client.list_objects_v2(
            Bucket=output_bucket,
            Prefix=job_output_prefix
        )
        
        files_found = []
        if 'Contents' in response:
            files_found = [obj['Key'].replace(job_output_prefix, '') for obj in response['Contents']]
            
            # Check if we have the expected output files
            html_files = [f for f in files_found if f.endswith('.html')]
            
            if html_files:
                status = "COMPLETED"
                print(f"Job {job_id} completed - found {len(html_files)} HTML files")
            else:
                status = "IN_PROGRESS"
                print(f"Job {job_id} in progress - found {len(files_found)} files but no HTML yet")
        else:
            status = "IN_PROGRESS"
            print(f"Job {job_id} in progress - no output files found yet")
        
        # Return status response
        return {
            "jobId": job_id,
            "status": status,
            "outputLocation": f"s3://{output_bucket}/{job_output_prefix}",
            "filesFound": files_found
        }
        
    except Exception as e:
        error_message = str(e)
        print(f"Error checking status for job {job_id}: {error_message}")
        
        # Return error response
        return {
            "jobId": job_id,
            "status": "FAILED",
            "error": error_message,
            "outputLocation": f"s3://{output_bucket}/{output_prefix}{job_id}/"
        }