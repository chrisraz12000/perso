import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaymentStatus } from '@prisma/client';
import { safeCompare } from '../../common/utils/safe-compare.util';
import { PaymentService } from './payment.service';
import {
  AirtelCallbackPayload,
  MvolaCallbackPayload,
  OrangeCallbackPayload,
  PaypalWebhookEvent,
} from './interfaces/webhook-payloads.interface';

@ApiTags('payments')
@Controller('payments')
export class PaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly config: ConfigService,
  ) {}

  @Post('rides/:rideId/initiate')
  @ApiOperation({ summary: "Charge a ride using its passenger's chosen payment method" })
  initiate(@Param('rideId', ParseUUIDPipe) rideId: string) {
    return this.paymentService.initiatePayment(rideId);
  }

  @Get('rides/:rideId/status')
  @ApiOperation({ summary: 'Refresh and return the payment status of a ride (polling fallback)' })
  refreshStatus(@Param('rideId', ParseUUIDPipe) rideId: string) {
    return this.paymentService.refreshStatus(rideId);
  }

  @Post('mvola/callback')
  @ApiOperation({ summary: 'MVola payment confirmation webhook' })
  async mvolaCallback(@Body() body: MvolaCallbackPayload) {
    if (!body?.serverCorrelationId || !body?.status) {
      throw new BadRequestException('Invalid MVola callback payload');
    }
    await this.paymentService.confirmPayment({
      providerRef: body.serverCorrelationId,
      status: body.status === 'completed' ? PaymentStatus.SUCCESS : PaymentStatus.FAILED,
      externalRef: body.transactionReference,
    });
    return { message: 'OK' };
  }

  @Post('airtel/callback')
  @ApiOperation({ summary: 'Airtel Money payment confirmation webhook' })
  async airtelCallback(@Body() body: AirtelCallbackPayload) {
    if (!body?.transaction?.id || !body?.transaction?.status) {
      throw new BadRequestException('Invalid Airtel callback payload');
    }
    await this.paymentService.confirmPayment({
      providerRef: body.transaction.id,
      status: body.transaction.status === 'TS' ? PaymentStatus.SUCCESS : PaymentStatus.FAILED,
      externalRef: body.transaction.airtel_money_id,
    });
    return { message: 'OK' };
  }

  @Post('orange/callback')
  @ApiOperation({ summary: 'Orange Money payment confirmation webhook' })
  async orangeCallback(
    @Headers('x-orange-notif-token') notifToken: string | undefined,
    @Body() body: OrangeCallbackPayload,
  ) {
    const expectedToken = this.config.getOrThrow<string>('ORANGE_NOTIF_TOKEN');
    if (!notifToken || !safeCompare(notifToken, expectedToken)) {
      throw new UnauthorizedException('Invalid Orange notification token');
    }
    if (!body?.pay_token || !body?.status) {
      throw new BadRequestException('Invalid Orange callback payload');
    }

    await this.paymentService.confirmPayment({
      providerRef: body.pay_token,
      status: body.status === 'SUCCESS' ? PaymentStatus.SUCCESS : PaymentStatus.FAILED,
      externalRef: body.txnid,
    });
    return { message: 'OK' };
  }

  @Post('paypal/callback')
  @ApiOperation({ summary: 'PayPal order/capture webhook' })
  async paypalCallback(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: PaypalWebhookEvent,
  ) {
    const paypal = this.paymentService.getPaypalProvider();
    const isValid = await paypal.verifyWebhookSignature(headers, body);
    if (!isValid) {
      throw new UnauthorizedException('Invalid PayPal webhook signature');
    }

    if (body.event_type === 'CHECKOUT.ORDER.APPROVED') {
      const capture = await paypal.capture(body.resource.id);
      await this.paymentService.confirmPayment({
        providerRef: body.resource.id,
        status: capture.status,
        externalRef: capture.externalRef,
      });
    } else if (body.event_type === 'PAYMENT.CAPTURE.DENIED') {
      await this.paymentService.confirmPayment({
        providerRef: body.resource.supplementary_data?.related_ids?.order_id ?? body.resource.id,
        status: PaymentStatus.FAILED,
        externalRef: body.resource.id,
      });
    }

    return { message: 'OK' };
  }
}
