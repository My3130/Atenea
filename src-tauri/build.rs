fn main() {
    // Indica a Cargo que vuelva a compilar si el archivo .env cambia
    println!("cargo:rerun-if-changed=.env");

    // Intenta cargar el archivo .env ubicado en la carpeta src-tauri/
    let _ = dotenvy::dotenv();

    // Inyecta las claves para que la macro env!() de lib.rs las reciba en tiempo de compilación
    if let Ok(val) = std::env::var("SUPABASE_ANON_KEY") {
        println!("cargo:rustc-env=SUPABASE_ANON_KEY={}", val);
    }
    if let Ok(val) = std::env::var("GOOGLE_BOOKS_API_KEY") {
        println!("cargo:rustc-env=GOOGLE_BOOKS_API_KEY={}", val);
    }

    tauri_build::build();
}