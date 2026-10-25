import { Module } from '@nestjs/common';
import { InsightsModule } from '../insights/insights.module';
import { TaxModule } from '../tax/tax.module';
import { DashboardInsightsController } from './dashboard-insights.controller';
import { DashboardInsightsService } from './dashboard-insights.service';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DashboardRepository } from './dashboard.repository';
import { DashboardInsightsRepository } from './dashboard-insights.repository';

@Module({ imports: [InsightsModule, TaxModule], controllers: [DashboardController, DashboardInsightsController], providers: [DashboardInsightsRepository, DashboardRepository, DashboardService, DashboardInsightsService] })
export class DashboardModule {}
