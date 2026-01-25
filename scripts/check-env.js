#!/usr/bin/env node

/**
 * Environment validation script
 * Run this in CI/CD or locally to ensure all required environment variables are set
 * Usage: node scripts/check-env.js
 */

// Simple color output without external dependencies
const colors = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  blue: (s) => `\x1b[34m${s}\x1b[0m`,
};

// Define required environment variables
const REQUIRED_VARS = {
  // Supabase Configuration
  'NEXT_PUBLIC_SUPABASE_URL': {
    description: 'Supabase project URL',
    example: 'https://your-project.supabase.co',
    required: true
  },
  'NEXT_PUBLIC_SUPABASE_ANON_KEY': {
    description: 'Supabase anonymous/public key',
    example: 'eyJ...',
    required: true
  },
  'SUPABASE_SERVICE_KEY': {
    description: 'Supabase service role key (for server-side operations)',
    example: 'eyJ...',
    required: process.env.NODE_ENV === 'production',
    production: true
  },
  
  // NextAuth Configuration
  'NEXTAUTH_SECRET': {
    description: 'Secret for JWT encryption',
    example: 'generate with: openssl rand -base64 32',
    required: true
  },
  'NEXTAUTH_URL': {
    description: 'Application URL for callbacks',
    example: 'https://planner.orangejelly.co.uk',
    required: process.env.NODE_ENV === 'production',
    production: true
  }
};

// Optional environment variables
const OPTIONAL_VARS = {
  'NODE_ENV': {
    description: 'Node environment',
    example: 'development | production',
    default: 'development'
  },
  'PORT': {
    description: 'Server port',
    example: '3000',
    default: '3000'
  },
  'MICROSOFT_CLIENT_ID': {
    description: 'Azure App Registration client ID (daily digest email)',
    example: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
  },
  'MICROSOFT_CLIENT_SECRET': {
    description: 'Azure App Registration client secret (daily digest email)',
    example: '***'
  },
  'MICROSOFT_TENANT_ID': {
    description: 'Microsoft Entra tenant ID (daily digest email)',
    example: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
  },
  'MICROSOFT_USER_EMAIL': {
    description: 'Mailbox used to send/receive digest (daily digest email)',
    example: 'peter@orangejelly.co.uk'
  }
};

function validateEnvironment() {
  console.log('🔍 Validating environment configuration...\n');
  
  const errors = [];
  const warnings = [];
  const success = [];
  
  // Check required variables
  for (const [varName, config] of Object.entries(REQUIRED_VARS)) {
    const value = process.env[varName];
    
    if (!value) {
      if (config.required === true) {
        errors.push({
          name: varName,
          message: `Missing required variable: ${varName}`,
          description: config.description,
          example: config.example
        });
      } else if (config.production && process.env.NODE_ENV === 'production') {
        errors.push({
          name: varName,
          message: `Missing required variable for production: ${varName}`,
          description: config.description,
          example: config.example
        });
      } else {
        warnings.push({
          name: varName,
          message: `Optional variable not set: ${varName}`,
          description: config.description,
          example: config.example
        });
      }
    } else {
      // Validate format
      let isValid = true;
      let validationMessage = '';
      
      // Specific validations
      if (varName === 'NEXT_PUBLIC_SUPABASE_URL') {
        if (!value.startsWith('https://') || !value.includes('.supabase.co')) {
          isValid = false;
          validationMessage = 'Invalid Supabase URL format';
        }
      } else if (varName.includes('KEY') || varName === 'NEXTAUTH_SECRET') {
        if (value.length < 32) {
          isValid = false;
          validationMessage = 'Key/Secret appears too short';
        }
      } else if (varName === 'NEXTAUTH_URL') {
        if (!value.startsWith('http://') && !value.startsWith('https://')) {
          isValid = false;
          validationMessage = 'URL must start with http:// or https://';
        }
      }
      
      if (!isValid) {
        errors.push({
          name: varName,
          message: `Invalid format: ${varName}`,
          description: validationMessage,
          example: config.example
        });
      } else {
        success.push({
          name: varName,
          value: value.substring(0, 10) + '...' // Show partial value for security
        });
      }
    }
  }
  
  // Check optional variables
  for (const [varName, config] of Object.entries(OPTIONAL_VARS)) {
    const value = process.env[varName];
    
    if (!value) {
      warnings.push({
        name: varName,
        message: config.default
          ? `Optional variable not set (will use default): ${varName}`
          : `Optional variable not set: ${varName}`,
        description: config.description,
        default: config.default
      });
    } else {
      success.push({
        name: varName,
        value: value
      });
    }
  }
  
  // Additional validation checks
  if (process.env.NODE_ENV === 'production') {
    // Production-specific checks
    if (process.env.NEXTAUTH_URL && !process.env.NEXTAUTH_URL.startsWith('https://')) {
      warnings.push({
        name: 'NEXTAUTH_URL',
        message: 'Production URL should use HTTPS',
        description: 'Consider using HTTPS for production deployments'
      });
    }
    
    if (!process.env.SUPABASE_SERVICE_KEY) {
      errors.push({
        name: 'SUPABASE_SERVICE_KEY',
        message: 'Service key is required for production',
        description: 'Production deployments should use service key for better security'
      });
    }
  }
  
  // Check for URL consistency
  if (process.env.NODE_ENV === 'production' && process.env.NEXTAUTH_URL) {
    if (process.env.NEXTAUTH_URL !== 'https://planner.orangejelly.co.uk' && 
        !process.env.NEXTAUTH_URL.includes('localhost')) {
      warnings.push({
        name: 'NEXTAUTH_URL',
        message: 'Unexpected production URL',
        description: `Expected: https://planner.orangejelly.co.uk, Got: ${process.env.NEXTAUTH_URL}`
      });
    }
  }
  
  // Print results
  console.log('━'.repeat(60));
  
  if (success.length > 0) {
    console.log('\n✅ Valid configuration:');
    success.forEach(item => {
      console.log(colors.green(`  ✓ ${item.name}: ${item.value}`));
    });
  }
  
  if (warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    warnings.forEach(item => {
      console.log(colors.yellow(`  ⚠ ${item.name}`));
      console.log(colors.yellow(`    ${item.message}`));
      if (item.description) {
        console.log(colors.yellow(`    ${item.description}`));
      }
      if (item.default) {
        console.log(colors.yellow(`    Default: ${item.default}`));
      }
    });
  }
  
  if (errors.length > 0) {
    console.log('\n❌ Errors:');
    errors.forEach(item => {
      console.log(colors.red(`  ✗ ${item.name}`));
      console.log(colors.red(`    ${item.message}`));
      if (item.description) {
        console.log(colors.red(`    ${item.description}`));
      }
      if (item.example) {
        console.log(colors.blue(`    Example: ${item.example}`));
      }
    });
  }
  
  console.log('\n' + '━'.repeat(60));
  
  // Summary
  const totalChecks = Object.keys(REQUIRED_VARS).length + Object.keys(OPTIONAL_VARS).length;
  console.log(`\n📊 Summary:`);
  console.log(`  Total checks: ${totalChecks}`);
  console.log(`  ✅ Passed: ${success.length}`);
  console.log(`  ⚠️  Warnings: ${warnings.length}`);
  console.log(`  ❌ Errors: ${errors.length}`);
  
  if (errors.length === 0) {
    console.log(colors.green('\n✨ Environment configuration is valid!'));
    process.exit(0);
  } else {
    console.log(colors.red(`\n💥 Environment validation failed with ${errors.length} error(s)`));
    console.log(colors.red('Please fix the errors above before proceeding.'));
    process.exit(1);
  }
}

// Run validation
try {
  validateEnvironment();
} catch (error) {
  console.error(colors.red('Unexpected error during validation:'), error);
  process.exit(1);
}
