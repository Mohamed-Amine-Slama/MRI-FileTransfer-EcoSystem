import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/db/database.module';
import { EventsModule } from '../../shared/events/events.module';
import { StorageModule } from '../../shared/storage/storage.module';
import { SignedUrlService } from '../../shared/storage/signed-url.service';
import { DicomWebController } from './internal/dicomweb.controller';
import { IngestionService } from './internal/ingestion.service';
import { OrthancHttpClient } from './internal/orthanc.http-client';
import { ORTHANC_CLIENT } from './internal/orthanc.client';
import { StudiesController } from './internal/studies.controller';
import { StudyAccessService } from './internal/study-access.service';
import { ThumbnailService } from './internal/thumbnail.service';
import { TwinService } from './internal/twin.service';
import { UploadService } from './internal/upload.service';
import { UploadsController } from './internal/uploads.controller';

@Module({
  imports: [DatabaseModule, EventsModule, StorageModule],
  controllers: [DicomWebController, StudiesController, UploadsController],
  providers: [
    UploadService,
    IngestionService,
    StudyAccessService,
    ThumbnailService,
    TwinService,
    SignedUrlService,
    OrthancHttpClient,
    // The ingestion pipeline depends on the interface, not the HTTP class, so
    // tests can substitute an in-memory Orthanc without touching production
    // wiring (ADR-3: Orthanc is an index, and ingest must survive its outage).
    { provide: ORTHANC_CLIENT, useExisting: OrthancHttpClient },
  ],
  exports: [UploadService, IngestionService, StudyAccessService, TwinService],
})
export class ImagingModule {}
