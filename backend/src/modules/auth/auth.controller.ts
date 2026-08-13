import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { Public } from '../../common/decorators/public.decorator';
import { LoginDto, RefreshDto, RegisterDto } from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // SEC-C1: registro público → límite estrecho por IP para frenar abuso/creación masiva.
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Public()
  @Post('register')
  @HttpCode(201)
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  // SEC-C1: login público sin lockout era el vector de toma de cuenta admin por fuerza
  // bruta. Se limita a 5 intentos/min por IP (los fallos también consumen cupo).
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  // SEC-C1: refresh también público; límite algo más holgado para clientes legítimos.
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  logout() {
    // JWT stateless: el cliente descarta los tokens. (Blacklist = fase 2.)
    return;
  }
}
