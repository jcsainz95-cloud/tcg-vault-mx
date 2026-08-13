import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

/** Declara los roles mínimos permitidos para una ruta. Ver ARCHITECTURE §7. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
