#!/usr/bin/env node

/**
 * {{AGENT_NAME}} Agent - {{DESCRIPTION}}
 * Follows MentatLab roadmap standards with stdin/stdout JSON I/O model.
 */

const fs = require('fs');

/**
 * Process the agent request
 * @param {Object} inputData - The input data object
 * @returns {Object} The output data with metadata
 */
function processRequest(inputData) {
    const startTime = Date.now();
    
    // Extract input text
    const inputText = inputData.text || '';
    
    // TODO: Implement your agent logic here
    // This is a basic template - replace with your actual processing
    const result = `Processed: ${inputText}`;
    
    // Calculate processing time
    const processingTime = (Date.now() - startTime) / 1000;
    
    // Return response with mentat_meta for metrics collection
    return {
        result: result,
        mentat_meta: {
            tokens_input: inputText ? inputText.split(' ').length : 0,
            tokens_output: result ? result.split(' ').length : 0,
            seconds: Math.round(processingTime * 1000) / 1000,
            model: '{{AGENT_ID}}'
        }
    };
}

/**
 * Main function implementing stdin/stdout JSON I/O model
 */
function main() {
    let inputBuffer = '';
    
    process.stdin.setEncoding('utf8');
    
    process.stdin.on('data', (chunk) => {
        inputBuffer += chunk;
    });
    
    process.stdin.on('end', () => {
        try {
            if (!inputBuffer.trim()) {
                throw new Error('No input received from stdin');
            }
            
            const inputData = JSON.parse(inputBuffer.trim());
            console.error(`Processing input: ${JSON.stringify(inputData)}`);
            
            // Process the request
            const outputData = processRequest(inputData);
            
            // Write JSON output to stdout
            process.stdout.write(JSON.stringify(outputData));
            
            console.error('Processing completed successfully');
            
        } catch (error) {
            let errorResponse;
            
            if (error instanceof SyntaxError) {
                errorResponse = {
                    error: `Invalid JSON input: ${error.message}`,
                    mentat_meta: {
                        tokens_input: null,
                        tokens_output: null,
                        seconds: null,
                        model: '{{AGENT_ID}}'
                    }
                };
            } else {
                errorResponse = {
                    error: `Processing error: ${error.message}`,
                    mentat_meta: {
                        tokens_input: null,
                        tokens_output: null,
                        seconds: null,
                        model: '{{AGENT_ID}}'
                    }
                };
            }
            
            process.stdout.write(JSON.stringify(errorResponse));
            console.error(`Error: ${error.message}`);
            process.exit(1);
        }
    });
    
    process.stdin.on('error', (error) => {
        const errorResponse = {
            error: `Stdin error: ${error.message}`,
            mentat_meta: {
                tokens_input: null,
                tokens_output: null,
                seconds: null,
                model: '{{AGENT_ID}}'
            }
        };
        process.stdout.write(JSON.stringify(errorResponse));
        console.error(`Stdin error: ${error.message}`);
        process.exit(1);
    });
}

if (require.main === module) {
    main();
}

module.exports = { processRequest, main };