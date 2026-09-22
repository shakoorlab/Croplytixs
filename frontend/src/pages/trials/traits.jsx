import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

// material-ui
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import OutlinedInput from '@mui/material/OutlinedInput';
import InputAdornment from '@mui/material/InputAdornment';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import Tooltip from '@mui/material/Tooltip';

// project imports
import MainCard from 'components/MainCard';
import PageHeader from 'components/PageHeader';
import StatTile from 'components/StatTile';
import TrialTabs from 'sections/trials/TrialTabs';
import GrowthCurves from 'sections/trials/traits/GrowthCurves';
import TraitsTable from 'sections/trials/traits/TraitsTable';
import { NESTED_PANEL, NESTED_PANEL_FRAMED } from 'sections/trials/surfaces';
import { useTrialResults } from 'api/results';
import { buildTraitSeries, downloadText, traitsToCsv } from 'api/traits';
import { MODELS } from 'api/models';

// assets
import DownloadOutlined from '@ant-design/icons/DownloadOutlined';
import SearchOutlined from '@ant-design/icons/SearchOutlined';
import LineChartOutlined from '@ant-design/icons/LineChartOutlined';

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

// ==============================|| TRIALS - TRAITS ||============================== //

/**
 * The payoff screen: growth dynamics per genotype and the season traits
 * derived from them. Everything here is computed from the QC-accepted series
 * of one pinned model version — the "result set" — so a number a breeder
 * reads today is the number they read next month, unless a human changed it.
 */
export default function TrialTraits() {
  const { trialId } = useParams();
  const { trial, flights, isLoading, error, trialError } = useTrialResults(trialId);

  const [dap, setDap] = useState(null);
  const [selected, setSelected] = useState([]);
  const [filter, setFilter] = useState('');
  const [showAll, setShowAll] = useState(true);

  const series = useMemo(() => buildTraitSeries(flights, { coverAtDap: dap }), [flights, dap]);
  const { dates, genotypes, targetDap } = series;

  const dapOptions = useMemo(() => {
    if (!dates.length) return [];
    const min = Math.ceil(dates[0].dap / 5) * 5;
    const max = Math.floor(dates[dates.length - 1].dap / 5) * 5;
    const options = [];
    for (let value = min; value <= max; value += 5) options.push(value);
    return options;
  }, [dates]);

  const resultSet = useMemo(() => {
    const model = dates.length ? dates[dates.length - 1].model : null;
    const registry = MODELS.find((candidate) => candidate.label === model || candidate.version === model);
    return { label: model || '—', status: registry?.status || 'production' };
  }, [dates]);

  const summary = useMemo(() => {
    const complete = flights.filter((flight) => flight.status === 'complete' && flight.results);
    return {
      accepted: complete.reduce((sum, flight) => sum + flight.results.plots.filter((plot) => plot.qc !== 'rejected').length, 0),
      corrected: complete.reduce((sum, flight) => sum + flight.results.summary.edited, 0),
      rejected: complete.reduce((sum, flight) => sum + flight.results.summary.rejected, 0),
      pending: complete.reduce((sum, flight) => sum + flight.results.summary.pending, 0)
    };
  }, [flights]);

  const crumbs = [
    { label: 'Croplytix', to: '/' },
    { label: 'Field Trials', to: '/trials' }
  ];

  if (trialError) {
    return (
      <Grid container rowSpacing={2.5}>
        <Grid size={12}>
          <PageHeader crumbs={crumbs} title="Could not load trial" />
        </Grid>
        <Grid size={12}>
          <Alert severity="error" variant="outlined">
            {trialError.message}
          </Alert>
        </Grid>
      </Grid>
    );
  }

  const toggle = (genotype) =>
    setSelected((current) =>
      current.includes(genotype) ? current.filter((value) => value !== genotype) : [...current, genotype].slice(-6)
    );

  const exportCsv = () => {
    const slug = (trial?.name || trialId).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    downloadText(
      `${slug}-traits-${resultSet.label.replace(/[^a-z0-9.]+/gi, '-')}.csv`,
      traitsToCsv(series, { trialName: trial?.name || trialId })
    );
  };

  return (
    <Grid container rowSpacing={2.5} columnSpacing={2.75}>
      <Grid size={12}>
        <PageHeader
          crumbs={[...crumbs, { label: trial?.name || trialId, to: `/trials/${trialId}` }, { label: 'Traits' }]}
          title={trial?.name || 'Loading trial…'}
          subtitle={trial ? `${trial.crop} · ${trial.site} · ${trial.plots} plots` : undefined}
          actions={
            <Stack direction="row" sx={{ gap: 1 }}>
              <Tooltip title="Per-plot masks as PNG + GeoTIFF-aligned index, with the run manifest — arrives with the processing worker">
                <span>
                  <Button variant="outlined" color="secondary" disabled>
                    Masks + manifest
                  </Button>
                </span>
              </Tooltip>
              <Button variant="contained" startIcon={<DownloadOutlined />} onClick={exportCsv} disabled={!dates.length}>
                Export CSV
              </Button>
            </Stack>
          }
        />
      </Grid>

      <Grid size={12}>
        <TrialTabs trialId={trialId} current="traits" flagged={flights.reduce((sum, flight) => sum + (flight.flagged || 0), 0)}>
          {error && (
            <Alert severity="error" variant="outlined" sx={{ mb: 2 }}>
              Could not load results — {error.message}
            </Alert>
          )}
          {isLoading && <LinearProgress sx={{ height: 2, mb: 2 }} />}

          {!isLoading && !dates.length && (
            <Stack sx={(theme) => ({ ...NESTED_PANEL_FRAMED(theme), alignItems: 'center', gap: 1.5, py: 8, px: 3 })}>
              <Box sx={{ fontSize: '2rem', color: 'text.disabled', display: 'flex' }}>
                <LineChartOutlined />
              </Box>
              <Typography variant="subtitle1">No processed flights yet</Typography>
              <Typography variant="body2" color="text.secondary" align="center" sx={{ maxWidth: 440 }}>
                Traits are derived from the QC-accepted cover series. They appear once the first flight finishes inference; growth curves
                need two.
              </Typography>
            </Stack>
          )}

          {dates.length > 0 && (
            <Stack sx={{ gap: 2.5 }}>
              {/* ---- result set + controls ---- */}
              <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
                <FormControl size="small" sx={{ minWidth: 300 }}>
                  <InputLabel id="traits-set-label">Result set</InputLabel>
                  <Select labelId="traits-set-label" label="Result set" value="current">
                    <MenuItem value="current">
                      <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}>
                        <Box component="span" sx={mono}>
                          {resultSet.label}
                        </Box>
                        <Chip
                          size="small"
                          label={`${resultSet.status} · frozen for season`}
                          sx={{ bgcolor: 'success.lighter', color: 'success.main', height: 18, fontSize: '0.65rem' }}
                        />
                      </Stack>
                    </MenuItem>
                    <MenuItem value="rerun" disabled>
                      <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}>
                        <Box component="span" sx={mono}>
                          v2.3-rc1
                        </Box>
                        <Typography variant="caption" color="text.secondary">
                          not run on this trial — re-run from Models creates a parallel set
                        </Typography>
                      </Stack>
                    </MenuItem>
                  </Select>
                </FormControl>

                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel id="traits-dap-label">Cover at</InputLabel>
                  <Select
                    labelId="traits-dap-label"
                    label="Cover at"
                    value={targetDap ?? ''}
                    onChange={(event) => setDap(Number(event.target.value))}
                  >
                    {dapOptions.map((value) => (
                      <MenuItem key={value} value={value}>
                        {value} DAP
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>

              <Stack direction="row" sx={{ gap: 1.5, alignItems: 'stretch', flexWrap: 'wrap' }}>
                <StatTile label="Genotypes" value={genotypes.length} hint={`${summary.accepted} plot-dates in series`} />
                <StatTile
                  label="Dates"
                  value={dates.length}
                  hint={`${dates[0].dap}–${dates[dates.length - 1].dap} DAP · planting = first flight − 21 d`}
                />
                <StatTile
                  label="Corrections"
                  value={summary.corrected}
                  hint={`${summary.rejected} rejected · ${summary.pending} still pending`}
                  color={summary.pending ? 'warning.main' : 'text.primary'}
                />
              </Stack>

              {/* ---- curves ---- */}
              <MainCard content={false} sx={NESTED_PANEL}>
                <Stack direction="row" sx={{ px: 2.5, pt: 2, alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                  <Stack>
                    <Typography variant="subtitle1">Growth dynamics</Typography>
                    <Typography variant="caption" color="text.secondary">
                      mean of QC-accepted plots per genotype · {selected.length ? `${selected.length} selected` : 'top 8 by final cover'} ·
                      click a row to highlight
                    </Typography>
                  </Stack>
                  <Box sx={{ flex: 1 }} />
                  <FormControlLabel
                    control={<Switch size="small" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />}
                    label={<Typography variant="caption">all genotypes</Typography>}
                  />
                  {selected.length > 0 && (
                    <Button size="small" color="secondary" onClick={() => setSelected([])}>
                      Clear selection
                    </Button>
                  )}
                </Stack>
                <Box sx={{ px: 1.5, pb: 1.5 }}>
                  <GrowthCurves series={series} selected={selected} showAll={showAll} />
                </Box>
              </MainCard>

              {/* ---- table ---- */}
              <Stack direction="row" sx={{ alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                <Stack>
                  <Typography variant="subtitle1">Derived traits</Typography>
                  <Typography variant="caption" color="text.secondary">
                    per genotype, from the accepted series · ranked by final cover
                  </Typography>
                </Stack>
                <Box sx={{ flex: 1 }} />
                <OutlinedInput
                  size="small"
                  placeholder="Find genotype or plot"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  startAdornment={
                    <InputAdornment position="start">
                      <SearchOutlined />
                    </InputAdornment>
                  }
                  sx={{ width: 240 }}
                />
              </Stack>
              <TraitsTable genotypes={genotypes} targetDap={targetDap} selected={selected} onToggle={toggle} filter={filter} />
            </Stack>
          )}
        </TrialTabs>
      </Grid>
    </Grid>
  );
}
