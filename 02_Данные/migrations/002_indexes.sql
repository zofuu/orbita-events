-- Оптимизация (занятие 10): индексы под каталог, подсчёт занятых мест и кабинеты.
CREATE INDEX ix_events_status_start ON events (status, starts_at);
CREATE INDEX ix_events_category     ON events (category_id, status, starts_at);
CREATE INDEX ix_events_organizer    ON events (organizer_id);
CREATE INDEX ix_reg_event_status    ON registrations (event_id, status);
CREATE INDEX ix_reg_user_status     ON registrations (user_id, status);
CREATE INDEX ix_sessions_expires    ON sessions (expires_at);
CREATE INDEX ix_access_log_ts       ON access_log (ts);
