#!/bin/bash
set -e

FILE="$1"

if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Error: File not found: $FILE"
  exit 1
fi

echo "Incrementing version in: $FILE"

# Determine if this is a JS or CSS file to use correct comment syntax
if [[ "$FILE" == *.user.js ]]; then
  VERSION_PATTERN="^// @version"
elif [[ "$FILE" == *.user.css ]]; then
  VERSION_PATTERN="^@version"
else
  echo "Error: Unknown file type (not .user.js or .user.css)"
  exit 1
fi

# Extract current version
CURRENT_VERSION=$(grep -E "$VERSION_PATTERN" "$FILE" | head -1 | awk '{print $NF}' | tr -d '\r')

if [ -z "$CURRENT_VERSION" ]; then
  echo "Error: Could not find version in $FILE"
  exit 1
fi

echo "Current version: $CURRENT_VERSION"

# Increment version based on format
# Handle X.Y.Z format (e.g., 1.6.2 -> 1.6.3)
if [[ "$CURRENT_VERSION" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
  MAJOR="${BASH_REMATCH[1]}"
  MINOR="${BASH_REMATCH[2]}"
  PATCH="${BASH_REMATCH[3]}"
  NEW_PATCH=$((PATCH + 1))
  NEW_VERSION="$MAJOR.$MINOR.$NEW_PATCH"

# Handle X.Y format (e.g., 0.1 -> 0.2)
elif [[ "$CURRENT_VERSION" =~ ^([0-9]+)\.([0-9]+)$ ]]; then
  MAJOR="${BASH_REMATCH[1]}"
  MINOR="${BASH_REMATCH[2]}"
  NEW_MINOR=$((MINOR + 1))
  NEW_VERSION="$MAJOR.$NEW_MINOR"

else
  # Skip rather than abort: the workflow loop runs under `set -e`, and one
  # oddly-versioned file must not silently kill the bumps for every file after it.
  echo "Warning: Unsupported version format '$CURRENT_VERSION' in $FILE - skipping"
  exit 0
fi

echo "New version: $NEW_VERSION"

# Update version in the file
if [[ "$FILE" == *.user.js ]]; then
  sed -i "s|^// @version.*|// @version      $NEW_VERSION|" "$FILE"
elif [[ "$FILE" == *.user.css ]]; then
  sed -i "s|^@version.*|@version     $NEW_VERSION|" "$FILE"
fi

echo "✓ Updated version in $FILE"

# Update README.md if the script is listed there
BASENAME=$(basename "$FILE")
# README links are URL-encoded (spaces -> %20), so match against that form
ENCODED=$(printf '%s' "$BASENAME" | sed 's/ /%20/g')
README="README.md"

if [ -f "$README" ]; then
  # Check if this file is mentioned in README
  if grep -q "$ENCODED" "$README"; then
    echo "Updating version in README.md..."

    # Escape for a sed BRE address with / delimiter. Only ] [ \ . * ^ $ /
    # are special there; escaping ( ) + ? { | would CREATE BRE operators
    # (\( \) are groups), which silently broke matching for the one
    # filename containing parentheses.
    ENCODED_ESCAPED=$(echo "$ENCODED" | sed 's/[][\.*^$/]/\\&/g')
    CURRENT_VERSION_ESCAPED=$(echo "$CURRENT_VERSION" | sed 's/[][\.*^$/]/\\&/g')

    # Replace version in the table row that contains this filename
    sed -i "/$ENCODED_ESCAPED/s/$CURRENT_VERSION_ESCAPED/$NEW_VERSION/g" "$README"

    echo "✓ Updated version in README.md"
  fi
fi

echo "Version increment complete!"
