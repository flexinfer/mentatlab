use std::io::{self, Read, Write};
use std::time::Instant;
use serde::{Deserialize, Serialize};
use serde_json;

/// Input data structure
#[derive(Deserialize)]
struct InputData {
    text: Option<String>,
}

/// Metadata structure for MentatLab metrics
#[derive(Serialize)]
struct MentatMeta {
    tokens_input: Option<usize>,
    tokens_output: Option<usize>,
    seconds: Option<f64>,
    model: String,
}

/// Output data structure
#[derive(Serialize)]
struct OutputData {
    result: String,
    mentat_meta: MentatMeta,
}

/// Error response structure
#[derive(Serialize)]
struct ErrorResponse {
    error: String,
    mentat_meta: MentatMeta,
}

/// Process the agent request
fn process_request(input_data: InputData) -> OutputData {
    let start_time = Instant::now();
    
    // Extract input text
    let input_text = input_data.text.unwrap_or_default();
    
    // TODO: Implement your agent logic here
    // This is a basic template - replace with your actual processing
    let result = format!("Processed: {}", input_text);
    
    // Calculate processing time
    let processing_time = start_time.elapsed().as_secs_f64();
    
    // Return response with mentat_meta for metrics collection
    OutputData {
        result: result.clone(),
        mentat_meta: MentatMeta {
            tokens_input: if input_text.is_empty() { Some(0) } else { Some(input_text.split_whitespace().count()) },
            tokens_output: if result.is_empty() { Some(0) } else { Some(result.split_whitespace().count()) },
            seconds: Some((processing_time * 1000.0).round() / 1000.0),
            model: "{{AGENT_ID}}".to_string(),
        },
    }
}

/// Create error response
fn create_error_response(error_msg: String) -> ErrorResponse {
    ErrorResponse {
        error: error_msg,
        mentat_meta: MentatMeta {
            tokens_input: None,
            tokens_output: None,
            seconds: None,
            model: "{{AGENT_ID}}".to_string(),
        },
    }
}

fn main() -> io::Result<()> {
    // Read JSON input from stdin
    let mut input_buffer = String::new();
    io::stdin().read_to_string(&mut input_buffer)?;
    
    if input_buffer.trim().is_empty() {
        let error_response = create_error_response("No input received from stdin".to_string());
        let json_output = serde_json::to_string(&error_response).unwrap();
        print!("{}", json_output);
        io::stdout().flush()?;
        std::process::exit(1);
    }
    
    // Parse JSON input
    let input_data: InputData = match serde_json::from_str(&input_buffer.trim()) {
        Ok(data) => {
            eprintln!("Processing input: {}", serde_json::to_string(&data).unwrap_or_default());
            data
        }
        Err(e) => {
            let error_response = create_error_response(format!("Invalid JSON input: {}", e));
            let json_output = serde_json::to_string(&error_response).unwrap();
            print!("{}", json_output);
            io::stdout().flush()?;
            eprintln!("JSON parse error: {}", e);
            std::process::exit(1);
        }
    };
    
    // Process the request
    let output_data = process_request(input_data);
    
    // Write JSON output to stdout
    match serde_json::to_string(&output_data) {
        Ok(json_output) => {
            print!("{}", json_output);
            io::stdout().flush()?;
            eprintln!("Processing completed successfully");
        }
        Err(e) => {
            let error_response = create_error_response(format!("JSON serialization error: {}", e));
            let json_output = serde_json::to_string(&error_response).unwrap();
            print!("{}", json_output);
            io::stdout().flush()?;
            eprintln!("JSON serialization error: {}", e);
            std::process::exit(1);
        }
    }
    
    Ok(())
}