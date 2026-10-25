import { Module } from '@nestjs/common';
import { OnboardingController, BusinessModelController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { OnboardingRepository } from './onboarding.repository';

@Module({
  controllers: [OnboardingController, BusinessModelController],
  providers: [OnboardingRepository, OnboardingService],
})
export class OnboardingModule {}
