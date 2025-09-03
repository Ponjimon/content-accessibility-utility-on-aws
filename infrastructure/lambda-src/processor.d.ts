import { Context } from 'aws-lambda';
interface ProcessorEvent {
    jobId?: string;
    inputS3Bucket: string;
    inputS3Key: string;
    outputS3Bucket: string;
    outputS3Prefix?: string;
    conversionOptions?: Record<string, any>;
}
interface ConversionResult {
    html_path: string;
    output_files: string[];
    pdf_pages: number;
    images_extracted: number;
    processing_time_seconds: number;
}
interface ProcessorResponse {
    jobId: string;
    status: 'COMPLETED' | 'FAILED';
    outputLocation?: string;
    conversionResult?: ConversionResult;
    inputLocation: string;
    error?: string;
}
export declare const handler: (event: ProcessorEvent, context: Context) => Promise<ProcessorResponse>;
export {};
