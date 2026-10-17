import { describeOutboxDrain } from './outbox-drain.contract'
import { createEffectOutboxDrain } from './outbox-drain.effect'

describeOutboxDrain('outbox drain on Effect', createEffectOutboxDrain)
