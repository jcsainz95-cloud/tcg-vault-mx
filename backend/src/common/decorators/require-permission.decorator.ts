import { SetMetadata } from '@nestjs/common';
import { Permission } from '@prisma/client';

export const PERMISSION_KEY = 'required_permission';

/**
 * Declara el permiso fino requerido para una ruta (ARCHITECTURE §7, §13.4.1). Lo verifica
 * `PermissionGuard` DESPUÉS de `JwtAuthGuard`. No se mezcla con `@Roles`: el panel de marketing usa
 * el permiso (no el rol) para permitir delegación futura.
 */
export const RequirePermission = (permission: Permission) => SetMetadata(PERMISSION_KEY, permission);
