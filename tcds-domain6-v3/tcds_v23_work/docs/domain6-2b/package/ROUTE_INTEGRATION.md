# Diagnostic Route Integration

Desired path:

`/__diagnostics/scanner-capture`

The page must be placed behind the **existing production diagnostic/admin/supervisor authorization mechanism**. Do not invent another role system for 6.2B.

Example shape only:

```tsx
<Route
  path="/__diagnostics/scanner-capture"
  element={
    <ExistingProtectedRoute requiredPermission="...">
      <ScannerCaptureDiagnosticPage />
    </ExistingProtectedRoute>
  }
/>
```

Use the actual production route/permission API.

The diagnostic route must not be linked into ordinary worker navigation unless governance explicitly approves it.
