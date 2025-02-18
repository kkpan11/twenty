import { Module, forwardRef } from '@nestjs/common';

import { MessageChannelMessageAssociationModule } from 'src/business/modules/message/repositories/message-channel-message-association/message-channel-message-assocation.module';
import { MessageThreadService } from 'src/business/modules/message/repositories/message-thread/message-thread.service';
import { MessageModule } from 'src/business/modules/message/repositories/message/message.module';
import { WorkspaceDataSourceModule } from 'src/engine/workspace-datasource/workspace-datasource.module';

@Module({
  imports: [
    WorkspaceDataSourceModule,
    MessageChannelMessageAssociationModule,
    forwardRef(() => MessageModule),
  ],
  providers: [MessageThreadService],
  exports: [MessageThreadService],
})
export class MessageThreadModule {}
