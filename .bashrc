zip() {
  # Absolute path to the Node.js script
  local SCRIPT_PATH="S:/Code/Node/nextjs/legislation-tracker/zip.js"
  local target_dir="${1:-.}"
      node "$SCRIPT_PATH" "$target_dir"
}