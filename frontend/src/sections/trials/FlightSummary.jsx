import PropTypes from 'prop-types';
import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Link from '@mui/material/Link';
import LinearProgress from '@mui/material/LinearProgress';

// project imports
import MainCard from 'components/MainCard';
import InfoTip from 'components/InfoTip';
import FlightStatusChip from 'sections/trials/FlightStatusChip';
import MapCopies from 'sections/trials/MapCopies';
import FlightUploadControls from 'sections/trials/FlightUpload';
import LifecycleChip from 'sections/models/LifecycleChip';
import { NESTED_PANEL } from 'sections/trials/surfaces';
import { formatBytes } from 'sections/trials/flight-setup/utils';
import { FLIGHT_STATUSES } from 'api/trials';
import { apiDownload } from 'api/client';
import { MODELS } from 'api/models';

// assets
import DashboardOutlined from '@ant-design/icons/DashboardOutlined';
import CalendarOutlined from '@ant-design/icons/CalendarOutlined';
import FileImageOutlined from '@ant-design/icons/FileImageOutlined';
import AppstoreOutlined from '@ant-design/icons/AppstoreOutlined';
import SettingOutlined from '@ant-design/icons/SettingOutlined';
import DownloadOutlined from '@ant-design/icons/DownloadOutlined';

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.8125rem' };

// A column name from the shapefile, shown as code so it reads as a name, not a word.
const columnSx = { ...mono, fontSize: '0.75rem', px: 0.5, py: 0.125, borderRadius: 0.5, bgcolor: 'grey.100', color: 'text.primary' };

const FILE_ROLES = { ortho: 'Orthophoto', shapefile: 'Shapefile part', clipped: 'Plot image', roster: 'Plot roster' };

const NOT_CHOSEN = 'Not chosen yet · picked when the flight is run';

// What the (i) beside each label says — one plain sentence per term.
const HELP = {
  processing: 'Processing cuts out every plot, finds its canopy and measures it. This shows how far along that is.',
  mapCopies:
    'Two copies of the orthophoto made after upload: a full-quality one for measuring plots, and a much smaller one for viewing the field on a map.',
  flown: 'The day the drone flew. Results are lined up by this date in the growth curves.',
  camera: 'The flying height and camera used. It decides which models suit this flight.',
  orthophoto: 'The single aerial image of the field, stitched together from the drone photos.',
  resolution: 'How much ground one pixel covers, and the map coordinate system (CRS) the image is placed in.',
  shapefile: 'The outline of every plot, drawn in GIS software. Each outline is used to cut that plot out of the orthophoto.',
  pattern: 'How plot details are read from each image’s file name; the parts in braces are the pieces it picks out.',
  plotIds: 'Which columns in the shapefile’s table name each plot, its genotype and its rep.',
  position: 'How far the plot outlines were nudged on the upload page so they sit on the plots in the image.',
  edgeTrim: 'Each plot outline is shrunk by this much before measuring, so paths and neighbouring plots don’t count toward its canopy.',
  model: 'The AI model that finds canopy in each plot image.',
  plotArea: 'What canopy cover is a percentage of.'
};

/**
 * One of the card's five boxes. Each has its own accent — a tinted header with
 * an icon and title in that colour — so the groups are told apart at a glance.
 * The colours are theme tokens, so they follow light and dark mode.
 */
function SectionBox({ title, icon, accent, children }) {
  return (
    <Box
      component="section"
      aria-label={title}
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid',
        borderColor: 'grey.A800',
        borderRadius: 1,
        bgcolor: 'background.paper',
        overflow: 'hidden'
      }}
    >
      <Stack
        direction="row"
        sx={{
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 1,
          bgcolor: `${accent}.lighter`,
          borderBottom: '1px solid',
          borderColor: 'grey.A800'
        }}
      >
        <Box sx={{ display: 'flex', fontSize: '1rem', color: `${accent}.main` }}>{icon}</Box>
        <Typography variant="subtitle2" component="h3" sx={{ color: `${accent}.main`, fontWeight: 600 }}>
          {title}
        </Typography>
      </Stack>
      <Box sx={{ px: 1.5, py: 0.5, flex: 1 }}>{children}</Box>
    </Box>
  );
}

SectionBox.propTypes = {
  title: PropTypes.string.isRequired,
  icon: PropTypes.node,
  accent: PropTypes.string.isRequired,
  children: PropTypes.node
};

// Label muted, value bright: the two read apart without having to look twice.
function Row({ label, help, children }) {
  return (
    <Stack
      direction="row"
      sx={{ gap: 2, py: 1, borderBottom: '1px dashed', borderColor: 'divider', '&:last-of-type': { borderBottom: 0 } }}
    >
      <Stack direction="row" sx={{ width: 124, flexShrink: 0, gap: 0.25, alignItems: 'flex-start' }}>
        <Typography variant="caption" color="text.secondary" sx={{ pt: 0.25 }}>
          {label}
        </Typography>
        {help && <InfoTip label={`About ${label.toLowerCase()}`} title={help} />}
      </Stack>
      <Box sx={{ flex: 1, minWidth: 0, color: 'text.primary' }}>{children}</Box>
    </Stack>
  );
}

Row.propTypes = { label: PropTypes.string.isRequired, help: PropTypes.string, children: PropTypes.node };

const Detail = ({ children }) => (
  <Typography variant="caption" color="text.secondary" component="div">
    {children}
  </Typography>
);

Detail.propTypes = { children: PropTypes.node };

const Column = ({ name }) => (
  <Box component="span" sx={columnSx}>
    {name}
  </Box>
);

Column.propTypes = { name: PropTypes.string };

// 'YYYY-MM-DD' is a calendar day, not an instant: read it as UTC so it never shifts a day.
function formatDay(iso) {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** The grid nudge from the upload page, in words. Positive dx is east, dy south, rotation clockwise. */
function describeOffset({ dxCm = 0, dyCm = 0, rotDeg = 0 }) {
  const moves = [];
  if (dxCm) moves.push(`${Math.abs(dxCm)} cm ${dxCm > 0 ? 'east' : 'west'}`);
  if (dyCm) moves.push(`${Math.abs(dyCm)} cm ${dyCm > 0 ? 'south' : 'north'}`);
  const parts = [];
  if (moves.length) parts.push(`Moved ${moves.join(' and ')}`);
  if (rotDeg) parts.push(`${parts.length ? 'rotated' : 'Rotated'} ${Math.abs(rotDeg)}° ${rotDeg > 0 ? 'clockwise' : 'anticlockwise'}`);
  return parts.length ? parts.join(', ') : 'As drawn in the shapefile';
}

// ==============================|| TRIALS - FLIGHT SUMMARY ||============================== //

/**
 * Everything recorded about one flight, in five boxes — where it stands, when
 * and how it was flown, how it will be processed, what was uploaded, how plots
 * were found in the image — in plain words, with an (i) for each technical
 * term. It is also the reproducibility record: every value that shapes a
 * result (files, grid nudge, model version) is here.
 */
// The download link streams the file through the API, and Cloud Run answers at
// most 32 MiB. Bigger files get signed download links along with the map viewer.
const MAX_DOWNLOAD_BYTES = 31 * 1024 * 1024;

export default function FlightSummary({ trialId, flight, onChanged, onUploadCancelled }) {
  const awaitingUpload = flight.status === 'awaiting_upload';
  const [downloadError, setDownloadError] = useState(null);
  const model = MODELS.find((candidate) => candidate.id === flight.modelId || candidate.label === flight.model);
  const { ortho, shapefile, mapping, offset } = flight;
  const hasPlotGrid = Boolean(mapping?.plot_id || mapping?.row || offset || flight.insetCm != null);

  const download = (file) => {
    setDownloadError(null);
    apiDownload(`/api/trials/${trialId}/flights/${flight.id}/files/${file.role}/${encodeURIComponent(file.name)}`, file.name).catch(
      (error) => setDownloadError(`Couldn’t download ${file.name}: ${error.message}`)
    );
  };

  return (
    <MainCard
      title="About This Flight"
      subheader={
        <Typography variant="caption" color="text.secondary">
          What was uploaded, and how it is processed
        </Typography>
      }
      sx={NESTED_PANEL}
    >
      <Grid container spacing={2}>
        {/* ---- where it stands ---- */}
        <Grid size={{ xs: 12, md: 6, lg: 4 }}>
          <SectionBox title="Progress" icon={<DashboardOutlined />} accent="primary">
            <Row label="Processing" help={HELP.processing}>
              <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}>
                <FlightStatusChip status={flight.status} />
                {flight.status === 'running' && (
                  <>
                    <LinearProgress variant="determinate" value={flight.progress} sx={{ width: 90, height: 3 }} />
                    <Typography variant="caption" color="text.secondary">
                      {flight.progress}%
                    </Typography>
                  </>
                )}
              </Stack>
              {FLIGHT_STATUSES[flight.status] && <Detail>{FLIGHT_STATUSES[flight.status]}</Detail>}
              {flight.status === 'failed' && flight.error && (
                <Typography variant="caption" color="error.main" component="div">
                  {flight.error}
                </Typography>
              )}
            </Row>
            {awaitingUpload && (
              <Row label="Upload">
                <FlightUploadControls key={flight.id} trialId={trialId} flight={flight} onCancelled={onUploadCancelled} />
              </Row>
            )}
            {flight.source === 'ortho' && (
              <Row label="Map copies" help={HELP.mapCopies}>
                {awaitingUpload ? (
                  <Typography variant="body2" color="text.secondary">
                    Built once the upload finishes
                  </Typography>
                ) : (
                  /* keyed so a message about one flight doesn't follow you to the next */
                  <MapCopies key={flight.id} trialId={trialId} flight={flight} onChanged={onChanged} />
                )}
              </Row>
            )}
          </SectionBox>
        </Grid>

        {/* ---- when and how it was flown ---- */}
        <Grid size={{ xs: 12, md: 6, lg: 4 }}>
          <SectionBox title="Flight Details" icon={<CalendarOutlined />} accent="info">
            <Row label="Flown on" help={HELP.flown}>
              <Typography variant="body2">{formatDay(flight.flightDate)}</Typography>
              {flight.dap != null && <Detail>{flight.dap} days after planting</Detail>}
            </Row>
            <Row label="Camera" help={HELP.camera}>
              <Typography variant="body2">{flight.captureLabel || flight.capture}</Typography>
            </Row>
            <Row label="Uploaded by">
              <Typography variant="body2">{flight.createdBy || 'Unknown'}</Typography>
              <Detail>{new Date(flight.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</Detail>
            </Row>
          </SectionBox>
        </Grid>

        {/* ---- chosen when the flight is run ---- */}
        <Grid size={{ xs: 12, lg: 4 }}>
          <SectionBox title="Processing Settings" icon={<SettingOutlined />} accent="secondary">
            <Row label="Model" help={HELP.model}>
              {flight.model ? (
                <>
                  <Stack direction="row" sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Box component="span" sx={mono}>
                      {flight.model}
                    </Box>
                    {model && <LifecycleChip status={model.status} />}
                  </Stack>
                  <Detail>Pinned for this run. Running again with another version adds a separate set of results.</Detail>
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {NOT_CHOSEN}
                </Typography>
              )}
            </Row>
            <Row label="Plot area" help={HELP.plotArea}>
              {flight.denominator === 'polygon' && (
                <>
                  <Typography variant="body2">The plot outline</Typography>
                  <Detail>Corners outside the image aren’t counted</Detail>
                </>
              )}
              {flight.denominator === 'clip' && <Typography variant="body2">The whole plot image</Typography>}
              {!flight.denominator && (
                <Typography variant="body2" color="text.secondary">
                  {NOT_CHOSEN}
                </Typography>
              )}
            </Row>
          </SectionBox>
        </Grid>

        {/* ---- what was uploaded ---- */}
        <Grid size={{ xs: 12, lg: hasPlotGrid ? 7 : 12 }}>
          <SectionBox title="Uploaded Files" icon={<FileImageOutlined />} accent="success">
            {ortho && (
              <Row label="Orthophoto" help={HELP.orthophoto}>
                <Typography variant="body2" sx={mono} noWrap title={ortho.name}>
                  {ortho.name}
                </Typography>
                <Detail>
                  {[
                    ortho.bytes && formatBytes(ortho.bytes),
                    ortho.width && `${ortho.width} × ${ortho.height} pixels`,
                    // older flights recorded only the total, which counts an alpha band too
                    ortho.colourBandCount ? `${ortho.colourBandCount} colour bands` : ortho.bandCount && `${ortho.bandCount} bands`
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Detail>
              </Row>
            )}
            {ortho && (ortho.gsdCm || ortho.crs) && (
              <Row label="Resolution" help={HELP.resolution}>
                {ortho.gsdCm && <Typography variant="body2">{ortho.gsdCm} cm of ground per pixel</Typography>}
                {ortho.crs && <Detail>Coordinate system {ortho.crs}</Detail>}
              </Row>
            )}
            {shapefile && (
              <Row label="Plot shapefile" help={HELP.shapefile}>
                <Typography variant="body2" sx={mono} noWrap title={shapefile.name}>
                  {shapefile.name}
                </Typography>
                <Detail>
                  {[shapefile.featureCount && `${shapefile.featureCount} plot outlines`, shapefile.crs].filter(Boolean).join(' · ')}
                </Detail>
              </Row>
            )}
            {flight.filenamePattern && (
              <Row label="File names" help={HELP.pattern}>
                <Typography variant="body2" sx={mono}>
                  {flight.filenamePattern}
                </Typography>
              </Row>
            )}
            {flight.files?.length > 0 && !awaitingUpload && (
              <Row label="Download">
                <Stack sx={{ gap: 0.5 }}>
                  {flight.files.map((file) =>
                    file.bytes > MAX_DOWNLOAD_BYTES ? (
                      <Stack key={file.key} direction="row" sx={{ alignItems: 'baseline', gap: 0.75, minWidth: 0 }}>
                        <Typography component="span" variant="caption" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {FILE_ROLES[file.role] || file.role}
                        </Typography>
                        <Typography component="span" variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
                          {file.name} · {formatBytes(file.bytes)} · too large to download here yet
                        </Typography>
                      </Stack>
                    ) : (
                      <Link
                        key={file.key}
                        component="button"
                        type="button"
                        underline="hover"
                        onClick={() => download(file)}
                        sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, textAlign: 'left', minWidth: 0 }}
                      >
                        <Box component="span" sx={{ display: 'flex', fontSize: '0.75rem', alignSelf: 'center' }}>
                          <DownloadOutlined />
                        </Box>
                        <Typography component="span" variant="caption" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {FILE_ROLES[file.role] || file.role}
                        </Typography>
                        <Typography component="span" variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
                          {file.name} · {formatBytes(file.bytes)}
                        </Typography>
                      </Link>
                    )
                  )}
                  {downloadError && (
                    <Typography variant="caption" color="error" role="alert">
                      {downloadError}
                    </Typography>
                  )}
                </Stack>
              </Row>
            )}
          </SectionBox>
        </Grid>

        {/* ---- how plots were found in the image ---- */}
        {hasPlotGrid && (
          <Grid size={{ xs: 12, lg: 5 }}>
            <SectionBox title="Plot Grid" icon={<AppstoreOutlined />} accent="warning">
              {(mapping?.plot_id || mapping?.row) && (
                <Row label="Plot names" help={HELP.plotIds}>
                  <Stack sx={{ gap: 0.5 }}>
                    <Typography variant="body2">
                      Plot ID from{' '}
                      {mapping.identity === 'grid' ? (
                        <>
                          <Column name={mapping.row} /> and <Column name={mapping.col} />
                        </>
                      ) : (
                        <Column name={mapping.plot_id} />
                      )}
                    </Typography>
                    {mapping.genotype && (
                      <Typography variant="body2">
                        Genotype from <Column name={mapping.genotype} />
                      </Typography>
                    )}
                    {mapping.rep && (
                      <Typography variant="body2">
                        Rep from <Column name={mapping.rep} />
                      </Typography>
                    )}
                  </Stack>
                </Row>
              )}
              {offset && (
                <Row label="Position" help={HELP.position}>
                  <Typography variant="body2">{describeOffset(offset)}</Typography>
                </Row>
              )}
              {flight.insetCm != null && (
                <Row label="Edge trim" help={HELP.edgeTrim}>
                  <Typography variant="body2">{flight.insetCm ? `${flight.insetCm} cm from each plot edge` : 'None'}</Typography>
                </Row>
              )}
            </SectionBox>
          </Grid>
        )}
      </Grid>
    </MainCard>
  );
}

FlightSummary.propTypes = {
  trialId: PropTypes.string.isRequired,
  flight: PropTypes.object.isRequired,
  onChanged: PropTypes.func.isRequired,
  onUploadCancelled: PropTypes.func
};
