#!/bin/bash

# 🔐 Pre-Push Security Check
# Ejecuta este script ANTES de hacer push a GitHub
# Uso: bash pre-push-check.sh

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  🔐 Pre-Push Security Check - APS Data Extractor        ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Variables
ERRORS=0
WARNINGS=0

# Función para imprimir errores
print_error() {
    echo "❌ ERROR: $1"
    ((ERRORS++))
}

# Función para imprimir advertencias
print_warning() {
    echo "⚠️  WARNING: $1"
    ((WARNINGS++))
}

# Función para imprimir éxito
print_success() {
    echo "✅ $1"
}

echo "📋 Verificando estructura del proyecto..."
echo ""

# 1. Verificar que existen carpetas clave
if [ ! -d "backend" ]; then
    print_error "Carpeta 'backend' no encontrada"
else
    print_success "Carpeta 'backend' existe"
fi

if [ ! -d "frontend" ]; then
    print_error "Carpeta 'frontend' no encontrada"
else
    print_success "Carpeta 'frontend' existe"
fi

echo ""
echo "🔑 Verificando archivos .env..."
echo ""

# 2. Verificar que .env NO está siendo tracked
if git ls-files | grep -E "^\.env$|backend/.env$|frontend/.env$"; then
    print_error ".env está siendo tracked por git (CRÍTICO)"
    echo "   → Ejecuta: git rm --cached .env backend/.env frontend/.env"
else
    print_success "Archivos .env no están tracked"
fi

# 3. Verificar que .gitignore existe
if [ ! -f ".gitignore" ]; then
    print_warning ".gitignore no existe"
    echo "   → Crea uno con: echo '.env' > .gitignore"
else
    print_success ".gitignore existe"
    
    # Verificar que .gitignore contiene .env
    if grep -q "\.env" .gitignore; then
        print_success ".gitignore contiene '.env'"
    else
        print_warning ".gitignore NO contiene '.env'"
        echo "   → Agrega: echo '.env' >> .gitignore"
    fi
fi

echo ""
echo "📦 Verificando archivos de configuración..."
echo ""

# 4. Verificar plantilla backend (nombre del repo: env.example)
if [ -f "backend/env.example" ]; then
    print_success "backend/env.example existe"

    # No usar "secret" en el patrón: coincide con nombres/placeholders legítimos.
    if grep -qiE '^[[:space:]]*APS_CLIENT_(ID|SECRET)[[:space:]]*=[[:space:]]*your_' backend/env.example \
        && grep -q 'SESSION_SECRET=your_' backend/env.example; then
        print_success "backend/env.example conserva placeholders (no parece .env real)"
    else
        print_warning "Revisa backend/env.example: debería usar placeholders your_* / your_random_*"
    fi
else
    print_warning "backend/env.example no encontrado"
fi

if [ -f "frontend/.env.example" ]; then
    print_success "frontend/.env.example existe"
else
    print_warning "frontend/.env.example no encontrado"
fi

echo ""
echo "📄 Verificando archivos principales..."
echo ""

# 5. Verificar archivos importantes
FILES_REQUIRED=(
    "README.md"
    "backend/package.json"
    "backend/server.js"
    "frontend/package.json"
    "frontend/src/App.jsx"
)

for file in "${FILES_REQUIRED[@]}"; do
    if [ -f "$file" ]; then
        print_success "$file existe"
    else
        print_warning "$file no encontrado"
    fi
done

echo ""
echo "📊 Estado de Git..."
echo ""

# 6. Mostrar archivos a ser subidos
echo "Archivos a ser subidos con 'git push':"
git status --short | while read -r line; do
    if [[ $line == M* ]] || [[ $line == A* ]] || [[ $line == D* ]]; then
        echo "  $line"
    fi
done

echo ""
echo "⚠️  Archivos pendientes (sin staging):"
git status --short | grep "^??" || echo "  Ninguno"

echo ""
echo "════════════════════════════════════════════════════════════"
echo ""

# Resumen final
if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo "🎉 ¡TODO BIEN! Puedes hacer push con seguridad:"
    echo "   git push origin main"
    echo ""
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo "⚠️  Hay $WARNINGS advertencia(s) pero puedes proceder"
    echo "   Revisa los warnings arriba"
    echo ""
    exit 0
else
    echo "❌ Hay $ERRORS error(es) - DETÉN antes de hacer push"
    echo "   Corrige los errores arriba antes de continuar"
    echo ""
    exit 1
fi
