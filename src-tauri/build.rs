fn main() {
    // Re-run build script when icon changes so the exe gets the new icon
    println!("cargo:rerun-if-changed=icons/icon.ico");
    tauri_build::build()
}
