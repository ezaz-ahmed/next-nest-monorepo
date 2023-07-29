import { Inject, Injectable, forwardRef } from '@nestjs/common'
import Stripe from 'stripe'
import { ConfigService } from '@nestjs/config'
import { DonorService } from '@server/donor/donor.service'
import { CreateIntenteDto } from './dto/create-intent.dto'
import { PaymentIntent } from './type'
import { DonationService } from '@server/donation/donation.service'

@Injectable()
export class StripeService {
  private stripe

  constructor(
    private donorService: DonorService,
    private configService: ConfigService,
    @Inject(forwardRef(() => DonationService))
    private donationService: DonationService,
  ) {
    this.stripe = new Stripe(configService.get<string>('STRIPE_SECRET_KEY')!, {
      apiVersion: '2022-11-15'
    })
  }

  async stripeHook(sig: any, rawBody: any) {

    const event = this.stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_SIG
    )

    if (event['type'] === 'payment_intent.succeeded') {
      const intent = event.data.object as Stripe.Invoice

      await this.donationService.updateByPi(intent.id, {
        status: 'complete'
      })

    } else if (event['type'] === 'payment_intent.canceled') {
      const intent = event.data.object as Stripe.Invoice

      await this.donationService.updateByPi(intent.id, {
        status: 'cancelled'
      })
    }
  }

  async createIntent(createIntent: CreateIntenteDto) {
    const donorInfo = await this.getOrCreateDonor(createIntent.donor_id)

    const paymentIntentData: PaymentIntent = {
      customer: donorInfo?.stripe_id!,
      amount: createIntent.amount,
      currency: createIntent.currency.toLocaleLowerCase()
    }

    if (createIntent.description !== undefined) {
      paymentIntentData.metadata = {
        description: createIntent.description,
      }
    }

    return await this.stripe.paymentIntents.create({
      ...paymentIntentData, automatic_payment_methods: {
        enabled: true
      }
    })
  }

  private async getOrCreateDonor(
    donorId: number
  ) {
    const donorInfo = await this.donorService.findById(donorId)

    if (!donorInfo?.stripe_id) {
      const customer = await this.stripe.customers.create({
        email: donorInfo.email,
        metadata: {
          dcs_donor_id: donorId
        }
      })

      donorInfo.stripe_id = customer.id

      await this.donorService.update(donorId, {
        stripe_id: customer.id
      })
    }

    return donorInfo
  }
}
