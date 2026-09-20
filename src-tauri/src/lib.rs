// ============================================================================
// LIB.RS - Backend Tauri v2 de Atenea
// - Comando open_external blindado (sin cmd.exe, anti-RCE y anti-UNC)
// - Validación estricta con std::path::Path y extensiones canónicas
// - Consulta segura a Supabase con credenciales de entorno en tiempo de compilación
// - Motor Nativo Google Books con Clave API de entorno (0% exposición en Git)
// ============================================================================

use std::path::Path;
use std::time::Duration;
use tauri_plugin_opener::OpenerExt;

// ----------------------------------------------------------------------------
// 1. APERTURA SEGURA DE ARCHIVOS LOCALES Y ENLACES WEB
// ----------------------------------------------------------------------------
#[tauri::command]
fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let clean = url.trim().trim_matches('"').trim_matches('\'').trim();

    if clean.is_empty() {
        return Err("La ruta o URL proporcionada está vacía.".into());
    }

    // A) RECURSOS WEB (HTTP / HTTPS)
    if clean.starts_with("http://") || clean.starts_with("https://") {
        if clean.chars().any(|c| c.is_control()) {
            return Err("La URL contiene caracteres no válidos.".into());
        }

        app.opener()
            .open_url(clean, None::<&str>)
            .map_err(|e| format!("Error al abrir enlace en el navegador: {}", e))?;

        return Ok(());
    }

    // B) FILTRO DE SEGURIDAD CONTRA RUTAS DE RED (ANTI-UNC / ANTI-NTLM THEFT)
    if clean.starts_with(r"\\") || clean.starts_with("//") || clean.to_lowercase().starts_with("file:") {
        return Err("Por seguridad, no se permiten rutas de red remotas ni esquemas especiales.".into());
    }

    let path = Path::new(clean);

    // C) COMPROBACIÓN FÍSICA EN EL SISTEMA DE ARCHIVOS
    if !path.exists() {
        return Err(format!("El archivo local no existe en la ruta: {}", clean));
    }

    if !path.is_file() {
        return Err("La ruta especificada no corresponde a un archivo válido.".into());
    }

    // D) RESOLUCIÓN CANÓNICA Y NORMALIZACIÓN DE RUTA
    let canonical_path = std::fs::canonicalize(path)
        .map_err(|e| format!("No se pudo validar la ruta del archivo: {}", e))?;

    // E) VALIDACIÓN ESTRICTA DE EXTENSIONES PERMITIDAS
    let ext = canonical_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    let allowed_extensions = [
        // Documentos y libros
        "pdf", "epub", "mobi", "txt", "cbr", "cbz",
        // Audio
        "mp3", "flac", "wav", "ogg", "m4a",
        // Video
        "mp4", "mkv", "avi", "mov", "webm",
        // Imágenes
        "jpg", "jpeg", "png", "webp"
    ];

    if !allowed_extensions.contains(&ext.as_str()) {
        return Err(format!(
            "La extensión '.{}' no está permitida. Por seguridad solo se admiten documentos culturales o multimedia.",
            ext
        ));
    }

    let target_path_str = canonical_path.to_string_lossy();
    let clean_target_str = target_path_str.trim_start_matches(r"\\?\");

    // F) APERTURA CON EL LECTOR DEL SISTEMA
    app.opener()
        .open_path(clean_target_str, None::<&str>)
        .map_err(|e| format!("Error al abrir el archivo con el lector del sistema: {}", e))?;

    Ok(())
}

// ----------------------------------------------------------------------------
// 2. CONSULTA SEGURA A SUPABASE VÍA RPC (INSENSIBLE A TILDES)
// ----------------------------------------------------------------------------
#[tauri::command]
async fn search_supabase_catalog(
    query: String,
    creator: Option<String>,
    is_isbn: bool,
) -> Result<String, String> {
    const SUPABASE_URL: &str = "https://pkwriwasentlhuzzueht.supabase.co";
    // Clave leída de forma segura desde las variables de entorno de compilación
    const SUPABASE_ANON_KEY: &str = env!("SUPABASE_ANON_KEY");

    let clean_q = query.trim();
    if clean_q.is_empty() {
        return Ok("[]".to_string());
    }

    // Preparamos el payload JSON para la función RPC de Supabase
    let payload = if is_isbn {
        serde_json::json!({
            "p_isbn": clean_q,
            "p_title": null,
            "p_author": null
        })
    } else {
        let clean_c = creator.as_deref().unwrap_or("").trim();
        serde_json::json!({
            "p_isbn": null,
            "p_title": clean_q,
            "p_author": if clean_c.is_empty() { None } else { Some(clean_c) }
        })
    };

    let endpoint = format!("{}/rest/v1/rpc/buscar_catalogo", SUPABASE_URL);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .post(&endpoint)
        .header("apikey", SUPABASE_ANON_KEY)
        .header("Authorization", format!("Bearer {}", SUPABASE_ANON_KEY))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Fallo de conexión con catálogo: {}", e))?;

    if response.status().is_success() {
        let body = response.text().await.map_err(|e| e.to_string())?;
        Ok(body)
    } else {
        let status = response.status();
        let err_text = response.text().await.unwrap_or_default();
        Err(format!("Supabase respondió con estado: {} - {}", status, err_text))
    }
}

// ----------------------------------------------------------------------------
// 3. CONSULTA NATIVA A GOOGLE BOOKS CON CLAVE DE ENTORNO
// ----------------------------------------------------------------------------
#[tauri::command]
async fn search_google_books(
    query: String,
    creator: Option<String>,
    publisher: Option<String>,
    is_isbn: bool,
) -> Result<String, String> {
    // Clave leída de forma segura desde las variables de entorno de compilación
    const GOOGLE_BOOKS_API_KEY: &str = env!("GOOGLE_BOOKS_API_KEY");

    let clean_q = query.trim();
    if clean_q.is_empty() {
        return Ok("{\"items\":[]}".to_string());
    }

    let search_q = if is_isbn {
        format!("isbn:{}", clean_q)
    } else {
        let mut q = clean_q.to_string();
        if let Some(ref c) = creator {
            let clean_c = c.trim();
            if !clean_c.is_empty() {
                q.push_str(&format!(" inauthor:{}", clean_c));
            }
        }
        if let Some(ref p) = publisher {
            let clean_p = p.trim();
            if !clean_p.is_empty() {
                q.push_str(&format!(" inpublisher:{}", clean_p));
            }
        }
        q
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(6))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get("https://www.googleapis.com/books/v1/volumes")
        .query(&[
            ("q", &search_q),
            ("maxResults", &"25".to_string()),
            ("key", &GOOGLE_BOOKS_API_KEY.to_string()),
        ])
        .send()
        .await
        .map_err(|e| format!("Fallo de conexión con Google Books: {}", e))?;

    if response.status().is_success() {
        let body = response.text().await.map_err(|e| e.to_string())?;
        Ok(body)
    } else {
        Err(format!("Google Books respondió con estado: {}", response.status()))
    }
}

// ----------------------------------------------------------------------------
// 4. PUNTO DE ENTRADA TAURI V2
// ----------------------------------------------------------------------------
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            open_external,
            search_supabase_catalog,
            search_google_books
        ])
        .run(tauri::generate_context!())
        .expect("error while running atenea application");
    
}