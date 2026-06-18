import { QueryBackedTitleGenerationService } from '../../../core/auxiliary/QueryBackedTitleGenerationService';
import type ClaudianPlugin from '../../../main';
import { decodeMimoModelId } from '../models';
import { MimoAuxQueryRunner } from '../runtime/MimoAuxQueryRunner';
import { mimoChatUIConfig } from '../ui/MimoChatUIConfig';

export class MimoTitleGenerationService extends QueryBackedTitleGenerationService {
  constructor(plugin: ClaudianPlugin) {
    super({
      createRunner: () => new MimoAuxQueryRunner(plugin, {
        agentProfile: 'passive',
        artifactPurpose: 'title-gen',
      }),
      resolveModel: () => {
        const settings = plugin.settings as unknown as Record<string, unknown>;
        const titleModel = typeof settings.titleGenerationModel === 'string'
          ? settings.titleGenerationModel
          : '';
        if (!mimoChatUIConfig.ownsModel(titleModel, settings)) {
          return undefined;
        }

        return decodeMimoModelId(titleModel) ?? undefined;
      },
    });
  }
}
