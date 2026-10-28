import { Module } from '@nestjs/common';
import { OnboardingController, BusinessModelController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { OnboardingRepository } from './onboarding.repository';
import { RoleCustomizationController } from './role-customization.controller';
import { RoleCustomizationService } from './role-customization.service';

@Module({
  controllers: [OnboardingController, BusinessModelController, RoleCustomizationController],
  providers: [OnboardingRepository, OnboardingService, RoleCustomizationService],
})
export class OnboardingModule {}
