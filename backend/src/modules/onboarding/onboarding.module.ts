import { Module } from '@nestjs/common';
import { OnboardingController, BusinessModelController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

@Module({
  controllers: [OnboardingController, BusinessModelController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
