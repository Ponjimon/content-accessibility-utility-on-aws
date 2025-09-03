#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { InfrastructureStack } from '../lib/infrastructure-stack';

const app = new cdk.App();
new InfrastructureStack(app, 'ContentAccessibilityPdfToHtmlStack', {
  /* Environment configuration */
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: process.env.CDK_DEFAULT_REGION 
  },

  /* Stack description and tags */
  description: 'Content Accessibility Utility - PDF to HTML conversion using Step Functions',
  tags: {
    Project: 'ContentAccessibilityUtility',
    Component: 'PdfToHtmlConversion',
    Environment: 'Development', // Change as needed
  },
});