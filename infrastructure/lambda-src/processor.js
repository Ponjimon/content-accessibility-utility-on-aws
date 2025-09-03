"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const handler = async (event, context) => {
    try {
        // Extract required parameters from event
        const jobId = event.jobId || `job-${context.awsRequestId}`;
        const inputBucket = event.inputS3Bucket;
        const inputKey = decodeURIComponent(event.inputS3Key);
        const outputBucket = event.outputS3Bucket;
        const outputPrefix = event.outputS3Prefix || 'converted/';
        const conversionOptions = event.conversionOptions || {};
        console.log(`Processing job ${jobId}: Converting ${inputBucket}/${inputKey}`);
        // Initialize AWS S3 client
        const s3Client = new client_s3_1.S3Client({});
        // Create temporary file for PDF download
        const tempDir = os.tmpdir();
        const tempPdfPath = path.join(tempDir, `${jobId}.pdf`);
        try {
            // Download PDF file to temporary location
            const getObjectCommand = new client_s3_1.GetObjectCommand({
                Bucket: inputBucket,
                Key: inputKey
            });
            const response = await s3Client.send(getObjectCommand);
            if (!response.Body) {
                throw new Error('No data received from S3');
            }
            // Convert stream to buffer and write to temp file
            const chunks = [];
            const stream = response.Body;
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);
            fs.writeFileSync(tempPdfPath, buffer);
            const pdfSize = fs.statSync(tempPdfPath).size;
            console.log(`Downloaded PDF file: ${pdfSize} bytes`);
        }
        catch (error) {
            throw new Error(`Failed to download PDF: ${error}`);
        }
        // Create HTML content (placeholder implementation)
        const htmlContent = createHtmlContent(jobId, inputKey, inputBucket, fs.statSync(tempPdfPath).size, conversionOptions, context.awsRequestId);
        // Upload HTML result to output bucket
        const outputKey = `${outputPrefix}${jobId}/converted.html`;
        const putObjectCommand = new client_s3_1.PutObjectCommand({
            Bucket: outputBucket,
            Key: outputKey,
            Body: htmlContent,
            ContentType: 'text/html',
            Metadata: {
                'job-id': jobId,
                'source-bucket': inputBucket,
                'source-key': inputKey,
                'conversion-timestamp': context.awsRequestId
            }
        });
        await s3Client.send(putObjectCommand);
        // Create conversion result
        const conversionResult = {
            html_path: `s3://${outputBucket}/${outputKey}`,
            output_files: [outputKey],
            pdf_pages: 1,
            images_extracted: 0,
            processing_time_seconds: 1.0
        };
        // Construct output location
        const outputLocation = `s3://${outputBucket}/${outputPrefix}${jobId}/`;
        // Cleanup temporary file
        try {
            fs.unlinkSync(tempPdfPath);
        }
        catch (cleanupError) {
            // Ignore cleanup errors
        }
        // Return success response
        const response = {
            jobId,
            status: 'COMPLETED',
            outputLocation,
            conversionResult,
            inputLocation: `s3://${inputBucket}/${inputKey}`
        };
        console.log(`Job ${jobId} completed successfully`);
        return response;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const jobId = event.jobId || 'unknown';
        console.log(`Job ${jobId} failed: ${errorMessage}`);
        // Return failure response
        return {
            jobId,
            status: 'FAILED',
            error: errorMessage,
            inputLocation: `s3://${event.inputS3Bucket || ''}/${event.inputS3Key || ''}`
        };
    }
};
exports.handler = handler;
function createHtmlContent(jobId, inputKey, inputBucket, pdfSize, conversionOptions, requestId) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Converted PDF Document</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; }
        .conversion-info { background-color: #f0f8ff; border: 1px solid #0066cc; border-radius: 5px; padding: 15px; margin-bottom: 20px; }
        .metadata { background-color: #f9f9f9; border-left: 4px solid #ccc; padding: 10px 15px; margin: 10px 0; }
    </style>
</head>
<body>
    <div class="conversion-info">
        <h1>PDF to HTML Conversion Result</h1>
        <p><strong>Job ID:</strong> ${jobId}</p>
        <p><strong>Original File:</strong> ${inputKey}</p>
        <p><strong>Request ID:</strong> ${requestId}</p>
    </div>
    
    <div class="metadata">
        <h2>Document Metadata</h2>
        <ul>
            <li><strong>Source:</strong> s3://${inputBucket}/${inputKey}</li>
            <li><strong>File Size:</strong> ${pdfSize.toLocaleString()} bytes</li>
            <li><strong>Processing Options:</strong> ${JSON.stringify(conversionOptions, null, 2)}</li>
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
</html>`;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJvY2Vzc29yLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsicHJvY2Vzc29yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGtEQUFrRjtBQUVsRix1Q0FBeUI7QUFDekIsMkNBQTZCO0FBQzdCLHVDQUF5QjtBQTRCbEIsTUFBTSxPQUFPLEdBQUcsS0FBSyxFQUFFLEtBQXFCLEVBQUUsT0FBZ0IsRUFBOEIsRUFBRTtJQUNuRyxJQUFJLENBQUM7UUFDSCx5Q0FBeUM7UUFDekMsTUFBTSxLQUFLLEdBQUcsS0FBSyxDQUFDLEtBQUssSUFBSSxPQUFPLE9BQU8sQ0FBQyxZQUFZLEVBQUUsQ0FBQztRQUMzRCxNQUFNLFdBQVcsR0FBRyxLQUFLLENBQUMsYUFBYSxDQUFDO1FBQ3hDLE1BQU0sUUFBUSxHQUFHLGtCQUFrQixDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUN0RCxNQUFNLFlBQVksR0FBRyxLQUFLLENBQUMsY0FBYyxDQUFDO1FBQzFDLE1BQU0sWUFBWSxHQUFHLEtBQUssQ0FBQyxjQUFjLElBQUksWUFBWSxDQUFDO1FBQzFELE1BQU0saUJBQWlCLEdBQUcsS0FBSyxDQUFDLGlCQUFpQixJQUFJLEVBQUUsQ0FBQztRQUV4RCxPQUFPLENBQUMsR0FBRyxDQUFDLGtCQUFrQixLQUFLLGdCQUFnQixXQUFXLElBQUksUUFBUSxFQUFFLENBQUMsQ0FBQztRQUU5RSwyQkFBMkI7UUFDM0IsTUFBTSxRQUFRLEdBQUcsSUFBSSxvQkFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBRWxDLHlDQUF5QztRQUN6QyxNQUFNLE9BQU8sR0FBRyxFQUFFLENBQUMsTUFBTSxFQUFFLENBQUM7UUFDNUIsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUUsR0FBRyxLQUFLLE1BQU0sQ0FBQyxDQUFDO1FBRXZELElBQUksQ0FBQztZQUNILDBDQUEwQztZQUMx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Y3RDb21tYW5kLCBQdXRPYmplY3RDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXMzJztcbmltcG9ydCB7IENvbnRleHQgfSBmcm9tICdhd3MtbGFtYmRhJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgKiBhcyBvcyBmcm9tICdvcyc7XG5cbmludGVyZmFjZSBQcm9jZXNzb3JFdmVudCB7XG4gIGpvYklkPzogc3RyaW5nO1xuICBpbnB1dFMzQnVja2V0OiBzdHJpbmc7XG4gIGlucHV0UzNLZXk6IHN0cmluZztcbiAgb3V0cHV0UzNCdWNrZXQ6IHN0cmluZztcbiAgb3V0cHV0UzNQcmVmaXg/OiBzdHJpbmc7XG4gIGNvbnZlcnNpb25PcHRpb25zPzogUmVjb3JkPHN0cmluZywgYW55Pjtcbn1cblxuaW50ZXJmYWNlIENvbnZlcnNpb25SZXN1bHQge1xuICBodG1sX3BhdGg6IHN0cmluZztcbiAgb3V0cHV0X2ZpbGVzOiBzdHJpbmdbXTtcbiAgcGRmX3BhZ2VzOiBudW1iZXI7XG4gIGltYWdlc19leHRyYWN0ZWQ6IG51bWJlcjtcbiAgcHJvY2Vzc2luZ190aW1lX3NlY29uZHM6IG51bWJlcjtcbn1cblxuaW50ZXJmYWNlIFByb2Nlc3NvclJlc3BvbnNlIHtcbiAgam9iSWQ6IHN0cmluZztcbiAgc3RhdHVzOiAnQ09NUExFVEVEJyB8ICdGQUlMRUQnO1xuICBvdXRwdXRMb2NhdGlvbj86IHN0cmluZztcbiAgY29udmVyc2lvblJlc3VsdD86IENvbnZlcnNpb25SZXN1bHQ7XG4gIGlucHV0TG9jYXRpb246IHN0cmluZztcbiAgZXJyb3I/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjb25zdCBoYW5kbGVyID0gYXN5bmMgKGV2ZW50OiBQcm9jZXNzb3JFdmVudCwgY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8UHJvY2Vzc29yUmVzcG9uc2U+ID0+IHtcbiAgdHJ5IHtcbiAgICAvLyBFeHRyYWN0IHJlcXVpcmVkIHBhcmFtZXRlcnMgZnJvbSBldmVudFxuICAgIGNvbnN0IGpvYklkID0gZXZlbnQuam9iSWQgfHwgYGpvYi0ke2NvbnRleHQuYXdzUmVxdWVzdElkfWA7XG4gICAgY29uc3QgaW5wdXRCdWNrZXQgPSBldmVudC5pbnB1dFMzQnVja2V0O1xuICAgIGNvbnN0IGlucHV0S2V5ID0gZGVjb2RlVVJJQ29tcG9uZW50KGV2ZW50LmlucHV0UzNLZXkpO1xuICAgIGNvbnN0IG91dHB1dEJ1Y2tldCA9IGV2ZW50Lm91dHB1dFMzQnVja2V0O1xuICAgIGNvbnN0IG91dHB1dFByZWZpeCA9IGV2ZW50Lm91dHB1dFMzUHJlZml4IHx8ICdjb252ZXJ0ZWQvJztcbiAgICBjb25zdCBjb252ZXJzaW9uT3B0aW9ucyA9IGV2ZW50LmNvbnZlcnNpb25PcHRpb25zIHx8IHt9O1xuICAgIFxuICAgIGNvbnNvbGUubG9nKGBQcm9jZXNzaW5nIGpvYiAke2pvYklkfTogQ29udmVydGluZyAke2lucHV0QnVja2V0fS8ke2lucHV0S2V5fWApO1xuICAgIFxuICAgIC8vIEluaXRpYWxpemUgQVdTIFMzIGNsaWVudFxuICAgIGNvbnN0IHMzQ2xpZW50ID0gbmV3IFMzQ2xpZW50KHt9KTtcbiAgICBcbiAgICAvLyBDcmVhdGUgdGVtcG9yYXJ5IGZpbGUgZm9yIFBERiBkb3dubG9hZFxuICAgIGNvbnN0IHRlbXBEaXIgPSBvcy50bXBkaXIoKTtcbiAgICBjb25zdCB0ZW1wUGRmUGF0aCA9IHBhdGguam9pbih0ZW1wRGlyLCBgJHtqb2JJZH0ucGRmYCk7XG4gICAgXG4gICAgdHJ5IHtcbiAgICAgIC8vIERvd25sb2FkIFBERiBmaWxlIHRvIHRlbXBvcmFyeSBsb2NhdGlvblxuICAgICAgY29uc3QgZ2V0T2JqZWN0Q29tbWFuZCA9IG5ldyBHZXRPYmplY3RDb21tYW5kKHtcbiAgICAgICAgQnVja2V0OiBpbnB1dEJ1Y2tldCxcbiAgICAgICAgS2V5OiBpbnB1dEtleVxuICAgICAgfSk7XG4gICAgICBcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgczNDbGllbnQuc2VuZChnZXRPYmplY3RDb21tYW5kKTtcbiAgICAgIFxuICAgICAgaWYgKCFyZXNwb25zZS5Cb2R5KSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignTm8gZGF0YSByZWNlaXZlZCBmcm9tIFMzJyk7XG4gICAgICB9XG4gICAgICBcbiAgICAgIC8vIENvbnZlcnQgc3RyZWFtIHRvIGJ1ZmZlciBhbmQgd3JpdGUgdG8gdGVtcCBmaWxlXG4gICAgICBjb25zdCBjaHVua3M6IFVpbnQ4QXJyYXlbXSA9IFtdO1xuICAgICAgY29uc3Qgc3RyZWFtID0gcmVzcG9uc2UuQm9keSBhcyBhbnk7XG4gICAgICBcbiAgICAgIGZvciBhd2FpdCAoY29uc3QgY2h1bmsgb2Ygc3RyZWFtKSB7XG4gICAgICAgIGNodW5rcy5wdXNoKGNodW5rKTtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgY29uc3QgYnVmZmVyID0gQnVmZmVyLmNvbmNhdChjaHVua3MpO1xuICAgICAgZnMud3JpdGVGaWxlU3luYyh0ZW1wUGRmUGF0aCwgYnVmZmVyKTtcbiAgICAgIFxuICAgICAgY29uc3QgcGRmU2l6ZSA9IGZzLnN0YXRTeW5jKHRlbXBQZGZQYXRoKS5zaXplO1xuICAgICAgY29uc29sZS5sb2coYERvd25sb2FkZWQgUERGIGZpbGU6ICR7cGRmU2l6ZX0gYnl0ZXNgKTtcbiAgICAgIFxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBkb3dubG9hZCBQREY6ICR7ZXJyb3J9YCk7XG4gICAgfVxuICAgIFxuICAgIC8vIENyZWF0ZSBIVE1MIGNvbnRlbnQgKHBsYWNlaG9sZGVyIGltcGxlbWVudGF0aW9uKVxuICAgIGNvbnN0IGh0bWxDb250ZW50ID0gY3JlYXRlSHRtbENvbnRlbnQoam9iSWQsIGlucHV0S2V5LCBpbnB1dEJ1Y2tldCwgZnMuc3RhdFN5bmModGVtcFBkZlBhdGgpLnNpemUsIGNvbnZlcnNpb25PcHRpb25zLCBjb250ZXh0LmF3c1JlcXVlc3RJZCk7XG4gICAgXG4gICAgLy8gVXBsb2FkIEhUTUwgcmVzdWx0IHRvIG91dHB1dCBidWNrZXRcbiAgICBjb25zdCBvdXRwdXRLZXkgPSBgJHtvdXRwdXRQcmVmaXh9JHtqb2JJZH0vY29udmVydGVkLmh0bWxgO1xuICAgIGNvbnN0IHB1dE9iamVjdENvbW1hbmQgPSBuZXcgUHV0T2JqZWN0Q29tbWFuZCh7XG4gICAgICBCdWNrZXQ6IG91dHB1dEJ1Y2tldCxcbiAgICAgIEtleTogb3V0cHV0S2V5LFxuICAgICAgQm9keTogaHRtbENvbnRlbnQsXG4gICAgICBDb250ZW50VHlwZTogJ3RleHQvaHRtbCcsXG4gICAgICBNZXRhZGF0YToge1xuICAgICAgICAnam9iLWlkJzogam9iSWQsXG4gICAgICAgICdzb3VyY2UtYnVja2V0JzogaW5wdXRCdWNrZXQsXG4gICAgICAgICdzb3VyY2Uta2V5JzogaW5wdXRLZXksXG4gICAgICAgICdjb252ZXJzaW9uLXRpbWVzdGFtcCc6IGNvbnRleHQuYXdzUmVxdWVzdElkXG4gICAgICB9XG4gICAgfSk7XG4gICAgXG4gICAgYXdhaXQgczNDbGllbnQuc2VuZChwdXRPYmplY3RDb21tYW5kKTtcbiAgICBcbiAgICAvLyBDcmVhdGUgY29udmVyc2lvbiByZXN1bHRcbiAgICBjb25zdCBjb252ZXJzaW9uUmVzdWx0OiBDb252ZXJzaW9uUmVzdWx0ID0ge1xuICAgICAgaHRtbF9wYXRoOiBgczM6Ly8ke291dHB1dEJ1Y2tldH0vJHtvdXRwdXRLZXl9YCxcbiAgICAgIG91dHB1dF9maWxlczogW291dHB1dEtleV0sXG4gICAgICBwZGZfcGFnZXM6IDEsXG4gICAgICBpbWFnZXNfZXh0cmFjdGVkOiAwLFxuICAgICAgcHJvY2Vzc2luZ190aW1lX3NlY29uZHM6IDEuMFxuICAgIH07XG4gICAgXG4gICAgLy8gQ29uc3RydWN0IG91dHB1dCBsb2NhdGlvblxuICAgIGNvbnN0IG91dHB1dExvY2F0aW9uID0gYHMzOi8vJHtvdXRwdXRCdWNrZXR9LyR7b3V0cHV0UHJlZml4fSR7am9iSWR9L2A7XG4gICAgXG4gICAgLy8gQ2xlYW51cCB0ZW1wb3JhcnkgZmlsZVxuICAgIHRyeSB7XG4gICAgICBmcy51bmxpbmtTeW5jKHRlbXBQZGZQYXRoKTtcbiAgICB9IGNhdGNoIChjbGVhbnVwRXJyb3IpIHtcbiAgICAgIC8vIElnbm9yZSBjbGVhbnVwIGVycm9yc1xuICAgIH1cbiAgICBcbiAgICAvLyBSZXR1cm4gc3VjY2VzcyByZXNwb25zZVxuICAgIGNvbnN0IHJlc3BvbnNlOiBQcm9jZXNzb3JSZXNwb25zZSA9IHtcbiAgICAgIGpvYklkLFxuICAgICAgc3RhdHVzOiAnQ09NUExFVEVEJyxcbiAgICAgIG91dHB1dExvY2F0aW9uLFxuICAgICAgY29udmVyc2lvblJlc3VsdCxcbiAgICAgIGlucHV0TG9jYXRpb246IGBzMzovLyR7aW5wdXRCdWNrZXR9LyR7aW5wdXRLZXl9YFxuICAgIH07XG4gICAgXG4gICAgY29uc29sZS5sb2coYEpvYiAke2pvYklkfSBjb21wbGV0ZWQgc3VjY2Vzc2Z1bGx5YCk7XG4gICAgcmV0dXJuIHJlc3BvbnNlO1xuICAgIFxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbiAgICBjb25zdCBqb2JJZCA9IGV2ZW50LmpvYklkIHx8ICd1bmtub3duJztcbiAgICBjb25zb2xlLmxvZyhgSm9iICR7am9iSWR9IGZhaWxlZDogJHtlcnJvck1lc3NhZ2V9YCk7XG4gICAgXG4gICAgLy8gUmV0dXJuIGZhaWx1cmUgcmVzcG9uc2VcbiAgICByZXR1cm4ge1xuICAgICAgam9iSWQsXG4gICAgICBzdGF0dXM6ICdGQUlMRUQnLFxuICAgICAgZXJyb3I6IGVycm9yTWVzc2FnZSxcbiAgICAgIGlucHV0TG9jYXRpb246IGBzMzovLyR7ZXZlbnQuaW5wdXRTM0J1Y2tldCB8fCAnJ30vJHtldmVudC5pbnB1dFMzS2V5IHx8ICcnfWBcbiAgICB9O1xuICB9XG59O1xuXG5mdW5jdGlvbiBjcmVhdGVIdG1sQ29udGVudChqb2JJZDogc3RyaW5nLCBpbnB1dEtleTogc3RyaW5nLCBpbnB1dEJ1Y2tldDogc3RyaW5nLCBwZGZTaXplOiBudW1iZXIsIGNvbnZlcnNpb25PcHRpb25zOiBSZWNvcmQ8c3RyaW5nLCBhbnk+LCByZXF1ZXN0SWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBgPCFET0NUWVBFIGh0bWw+XG48aHRtbCBsYW5nPVwiZW5cIj5cbjxoZWFkPlxuICAgIDxtZXRhIGNoYXJzZXQ9XCJVVEYtOFwiPlxuICAgIDxtZXRhIG5hbWU9XCJ2aWV3cG9ydFwiIGNvbnRlbnQ9XCJ3aWR0aD1kZXZpY2Utd2lkdGgsIGluaXRpYWwtc2NhbGU9MS4wXCI+XG4gICAgPHRpdGxlPkNvbnZlcnRlZCBQREYgRG9jdW1lbnQ8L3RpdGxlPlxuICAgIDxzdHlsZT5cbiAgICAgICAgYm9keSB7IGZvbnQtZmFtaWx5OiBBcmlhbCwgc2Fucy1zZXJpZjsgbWF4LXdpZHRoOiA4MDBweDsgbWFyZ2luOiAwIGF1dG87IHBhZGRpbmc6IDIwcHg7IGxpbmUtaGVpZ2h0OiAxLjY7IH1cbiAgICAgICAgLmNvbnZlcnNpb24taW5mbyB7IGJhY2tncm91bmQtY29sb3I6ICNmMGY4ZmY7IGJvcmRlcjogMXB4IHNvbGlkICMwMDY2Y2M7IGJvcmRlci1yYWRpdXM6IDVweDsgcGFkZGluZzogMTVweDsgbWFyZ2luLWJvdHRvbTogMjBweDsgfVxuICAgICAgICAubWV0YWRhdGEgeyBiYWNrZ3JvdW5kLWNvbG9yOiAjZjlmOWY5OyBib3JkZXItbGVmdDogNHB4IHNvbGlkICNjY2M7IHBhZGRpbmc6IDEwcHggMTVweDsgbWFyZ2luOiAxMHB4IDA7IH1cbiAgICA8L3N0eWxlPlxuPC9oZWFkPlxuPGJvZHk+XG4gICAgPGRpdiBjbGFzcz1cImNvbnZlcnNpb24taW5mb1wiPlxuICAgICAgICA8aDE+UERGIHRvIEhUTUwgQ29udmVyc2lvbiBSZXN1bHQ8L2gxPlxuICAgICAgICA8cD48c3Ryb25nPkpvYiBJRDo8L3N0cm9uZz4gJHtqb2JJZH08L3A+XG4gICAgICAgIDxwPjxzdHJvbmc+T3JpZ2luYWwgRmlsZTo8L3N0cm9uZz4gJHtpbnB1dEtleX08L3A+XG4gICAgICAgIDxwPjxzdHJvbmc+UmVxdWVzdCBJRDo8L3N0cm9uZz4gJHtyZXF1ZXN0SWR9PC9wPlxuICAgIDwvZGl2PlxuICAgIFxuICAgIDxkaXYgY2xhc3M9XCJtZXRhZGF0YVwiPlxuICAgICAgICA8aDI+RG9jdW1lbnQgTWV0YWRhdGE8L2gyPlxuICAgICAgICA8dWw+XG4gICAgICAgICAgICA8bGk+PHN0cm9uZz5Tb3VyY2U6PC9zdHJvbmc+IHMzOi8vJHtpbnB1dEJ1Y2tldH0vJHtpbnB1dEtleX08L2xpPlxuICAgICAgICAgICAgPGxpPjxzdHJvbmc+RmlsZSBTaXplOjwvc3Ryb25nPiAke3BkZlNpemUudG9Mb2NhbGVTdHJpbmcoKX0gYnl0ZXM8L2xpPlxuICAgICAgICAgICAgPGxpPjxzdHJvbmc+UHJvY2Vzc2luZyBPcHRpb25zOjwvc3Ryb25nPiAke0pTT04uc3RyaW5naWZ5KGNvbnZlcnNpb25PcHRpb25zLCBudWxsLCAyKX08L2xpPlxuICAgICAgICA8L3VsPlxuICAgIDwvZGl2PlxuICAgIFxuICAgIDxkaXYgY2xhc3M9XCJjb250ZW50XCI+XG4gICAgICAgIDxoMj5Eb2N1bWVudCBDb250ZW50PC9oMj5cbiAgICAgICAgPHA+PGVtPlRoaXMgaXMgYSBTdGVwIEZ1bmN0aW9uIHdvcmtmbG93IGRlbW9uc3RyYXRpb24uIFRoZSBhY3R1YWwgaW1wbGVtZW50YXRpb24gd291bGQgaW50ZWdyYXRlIHdpdGggdGhlIGNvbnRlbnQgYWNjZXNzaWJpbGl0eSB1dGlsaXR5J3MgUERGIHRvIEhUTUwgY29udmVyc2lvbiBjYXBhYmlsaXRpZXMuPC9lbT48L3A+XG4gICAgICAgIFxuICAgICAgICA8cD5JbiBhIGZ1bGwgaW1wbGVtZW50YXRpb24sIHRoaXMgd291bGQ6PC9wPlxuICAgICAgICA8dWw+XG4gICAgICAgICAgICA8bGk+VXNlIEFXUyBCZWRyb2NrIERhdGEgQXV0b21hdGlvbiAoQkRBKSBmb3IgUERGIHBhcnNpbmc8L2xpPlxuICAgICAgICAgICAgPGxpPkV4dHJhY3QgdGV4dCwgaW1hZ2VzLCBhbmQgc3RydWN0dXJlIGZyb20gdGhlIFBERjwvbGk+XG4gICAgICAgICAgICA8bGk+R2VuZXJhdGUgYWNjZXNzaWJsZSBIVE1MIHdpdGggcHJvcGVyIHNlbWFudGljIG1hcmt1cDwvbGk+XG4gICAgICAgICAgICA8bGk+SW5jbHVkZSBleHRyYWN0ZWQgaW1hZ2VzIHdpdGggYXBwcm9wcmlhdGUgYWx0IHRleHQ8L2xpPlxuICAgICAgICAgICAgPGxpPlByZXNlcnZlIGRvY3VtZW50IGxheW91dCBhbmQgZm9ybWF0dGluZzwvbGk+XG4gICAgICAgIDwvdWw+XG4gICAgPC9kaXY+XG48L2JvZHk+XG48L2h0bWw+YDtcbn0iXX0=